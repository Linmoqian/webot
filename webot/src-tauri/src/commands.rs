use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

const WECHAT_DEDUP_MAX: usize = 1000;
const WECHAT_STATE_FILE: &str = "account.json";
const WECHAT_SESSION_EXPIRED: i64 = -14;
const WECHAT_RETRY_DELAY_SECS: u64 = 2;
const WECHAT_BACKOFF_DELAY_SECS: u64 = 30;
const WECHAT_SESSION_PAUSE_SECS: u64 = 60 * 60;
const WECHAT_MAX_CONSECUTIVE_FAILURES: u32 = 3;
const WECHAT_DEFAULT_POLL_TIMEOUT_SECS: u64 = 35;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct WechatRuntimeState {
    #[serde(default)]
    token: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    get_updates_buf: String,
    #[serde(default)]
    context_tokens: std::collections::HashMap<String, String>,
}

pub struct AppState {
    pub messages: Mutex<Vec<Value>>,
    pub settings: Mutex<crate::config::Settings>,
    pub wechat_poll_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub wechat_stop_tx: Mutex<Option<watch::Sender<bool>>>,
}

fn build_system_prompt_with_media(base_prompt: &str, media_dir: &Option<String>) -> String {
    if let Some(ref dir) = media_dir {
        let mut files = String::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if let Some(name) = entry.file_name().to_str() {
                    if !files.is_empty() {
                        files.push('\n');
                    }
                    files.push_str("- ");
                    files.push_str(name);
                }
            }
        }
        if !files.is_empty() {
            return format!(
                "{base_prompt}\n\n你可以发送媒体文件给用户。在回复中使用 [media: 文件名] 标记来发送文件，可以多个。可用的媒体文件：\n{files}"
            );
        }
    }
    base_prompt.to_string()
}

fn parse_media_markers(reply: &str) -> (String, Vec<String>) {
    let mut media_files = Vec::new();
    let mut clean = String::new();
    let mut remaining = reply;

    while let Some(start) = remaining.find("[media:") {
        clean.push_str(&remaining[..start]);
        let after = &remaining[start + 7..];
        if let Some(end) = after.find(']') {
            let filename = after[..end].trim().to_string();
            if !filename.is_empty() {
                media_files.push(filename);
            }
            remaining = &after[end + 1..];
        } else {
            clean.push_str("[media:");
            clean.push_str(after);
            remaining = "";
        }
    }
    clean.push_str(remaining);
    (clean.trim().to_string(), media_files)
}

fn wechat_state_dir() -> std::path::PathBuf {
    let base = crate::config::config_path()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    base.join("config").join("wechat_state")
}

fn wechat_state_path() -> std::path::PathBuf {
    wechat_state_dir().join(WECHAT_STATE_FILE)
}

fn load_wechat_runtime_state() -> WechatRuntimeState {
    let path = wechat_state_path();
    let Ok(content) = std::fs::read_to_string(path) else {
        return WechatRuntimeState::default();
    };
    serde_json::from_str(&content).unwrap_or_default()
}

fn save_wechat_runtime_state(state: &WechatRuntimeState) -> Result<(), String> {
    let dir = wechat_state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建微信状态目录失败: {e}"))?;
    let content = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(WECHAT_STATE_FILE), content)
        .map_err(|e| format!("保存微信状态失败: {e}"))
}

fn wechat_message_id(msg: &Value) -> Option<String> {
    if let Some(id) = msg.get("msg_id").and_then(|v| v.as_str()) {
        if !id.is_empty() {
            return Some(id.to_string());
        }
    }

    let from_user = msg.get("from_user_id").and_then(|v| v.as_str()).unwrap_or("");
    if from_user.is_empty() {
        return None;
    }

    let create_time = msg
        .get("create_time_ms")
        .or_else(|| msg.get("create_time"))
        .map(|v| {
            v.as_str()
                .map(str::to_string)
                .unwrap_or_else(|| v.to_string())
        })
        .unwrap_or_default();

    if create_time.is_empty() {
        None
    } else {
        Some(format!("{from_user}:{create_time}"))
    }
}

fn remember_wechat_message(
    seen_ids: &mut std::collections::HashSet<String>,
    seen_order: &mut std::collections::VecDeque<String>,
    msg_id: String,
) -> bool {
    if seen_ids.contains(&msg_id) {
        return false;
    }

    seen_ids.insert(msg_id.clone());
    seen_order.push_back(msg_id);

    while seen_order.len() > WECHAT_DEDUP_MAX {
        if let Some(old_id) = seen_order.pop_front() {
            seen_ids.remove(&old_id);
        }
    }

    true
}

async fn sleep_or_stop(stop_rx: &watch::Receiver<bool>, duration: std::time::Duration) -> bool {
    tokio::select! {
        _ = tokio::time::sleep(duration) => false,
        _ = async {
            let mut stop_rx = stop_rx.clone();
            loop {
                if *stop_rx.borrow() {
                    break;
                }
                if stop_rx.changed().await.is_err() {
                    break;
                }
            }
        } => true,
    }
}

#[tauri::command]
pub async fn start_chat(
    app: AppHandle,
    state: State<'_, AppState>,
    message: String,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();

    let all_msgs = {
        let mut msgs = state.messages.lock().unwrap();
        msgs.push(serde_json::json!({
            "role": "user",
            "content": message
        }));

        let max = settings.agent.max_context_messages;
        let start = if msgs.len() > max {
            msgs.len() - max
        } else {
            0
        };
        let system_content = build_system_prompt_with_media(
        &settings.agent.system_prompt,
        &settings.wechat.media_dir,
    );
        let mut all = vec![serde_json::json!({
            "role": "system",
            "content": system_content
        })];
        all.extend(msgs[start..].to_vec());
        all
    };

    let provider_config = settings.provider;

    tokio::spawn(async move {
        match crate::llm::stream_and_emit(&provider_config, &all_msgs, &app).await {
            Ok(full_response) => {
                let state = app.state::<AppState>();
                state.messages.lock().unwrap().push(serde_json::json!({
                    "role": "assistant",
                    "content": full_response
                }));
                let _ = app.emit("chat-done", serde_json::json!({}));
            }
            Err(e) => {
                let _ = app.emit("chat-error", serde_json::json!({ "message": e }));
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<crate::config::Settings, String> {
    Ok(state.settings.lock().unwrap().clone())
}

fn build_wechat_headers() -> reqwest::header::HeaderMap {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u32;
    let uin = BASE64.encode(ts.to_string());

    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("X-WECHAT-UIN", uin.parse().unwrap());
    headers.insert("Content-Type", "application/json".parse().unwrap());
    headers.insert("AuthorizationType", "ilink_bot_token".parse().unwrap());
    headers.insert("iLink-App-Id", "bot".parse().unwrap());
    headers.insert("iLink-App-ClientVersion", "131329".parse().unwrap());
    headers
}

#[tauri::command]
pub async fn fetch_wechat_qr(state: State<'_, AppState>) -> Result<Value, String> {
    let base_url = state.settings.lock().unwrap().clone().wechat.base_url;

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{}/ilink/bot/get_bot_qrcode", base_url))
        .query(&[("bot_type", "3")])
        .headers(build_wechat_headers())
        .send()
        .await
        .map_err(|e| format!("WeChat API 请求失败: {e}"))?;

    let data: Value = resp.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
    Ok(data)
}

#[tauri::command]
pub async fn poll_qr_status(
    state: State<'_, AppState>,
    qrcode_id: String,
    base_url_override: Option<String>,
) -> Result<Value, String> {
    let base_url = base_url_override.unwrap_or_else(|| {
        state.settings.lock().unwrap().clone().wechat.base_url
    });

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(format!("{}/ilink/bot/get_qrcode_status", base_url))
        .query(&[("qrcode", &qrcode_id)])
        .headers(build_wechat_headers())
        .send()
        .await
        .map_err(|e| format!("轮询状态失败: {e}"))?;

    let data: Value = resp.json().await.map_err(|e| format!("解析状态响应失败: {e}"))?;
    Ok(data)
}

#[tauri::command]
pub fn save_wechat_token(
    state: State<'_, AppState>,
    token: String,
    base_url: Option<String>,
) -> Result<(), String> {
    let mut settings = state.settings.lock().unwrap().clone();
    settings.wechat.token = token;
    if let Some(url) = base_url {
        settings.wechat.base_url = url;
    }
    crate::config::save_settings(&settings)?;
    let mut runtime_state = load_wechat_runtime_state();
    runtime_state.token = settings.wechat.token.clone();
    runtime_state.base_url = settings.wechat.base_url.clone();
    save_wechat_runtime_state(&runtime_state)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

pub(crate) fn build_auth_headers(token: &str) -> reqwest::header::HeaderMap {
    let mut headers = build_wechat_headers();
    if !token.is_empty() {
        headers.insert(
            "Authorization",
            format!("Bearer {token}").parse().unwrap(),
        );
    }
    headers
}

#[tauri::command]
pub async fn start_wechat_listener(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let runtime_state = load_wechat_runtime_state();
    let token = if settings.wechat.token.is_empty() {
        runtime_state.token.clone()
    } else {
        settings.wechat.token.clone()
    };
    if token.is_empty() {
        return Err("未登录微信，请先扫码登录".into());
    }
    let base_url = if settings.wechat.base_url.is_empty() && !runtime_state.base_url.is_empty() {
        runtime_state.base_url.clone()
    } else {
        settings.wechat.base_url.clone()
    };
    let provider_config = settings.provider.clone();
    let system_prompt = settings.agent.system_prompt.clone();
    let max_context = settings.agent.max_context_messages;
    let media_dir = settings.wechat.media_dir.clone();

    let system_prompt = build_system_prompt_with_media(&system_prompt, &media_dir);

    // Stop existing listener if any
    {
        if let Some(tx) = state.wechat_stop_tx.lock().unwrap().take() {
            let _ = tx.send(true);
        }
        if let Some(handle) = state.wechat_poll_handle.lock().unwrap().take() {
            handle.abort();
        }
    }

    let (stop_tx, stop_rx) = watch::channel(false);
    *state.wechat_stop_tx.lock().unwrap() = Some(stop_tx);

    let handle = tokio::spawn(async move {
        let mut poll_timeout_secs = WECHAT_DEFAULT_POLL_TIMEOUT_SECS;
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap();

        let mut runtime_state = runtime_state;
        runtime_state.token = token.clone();
        runtime_state.base_url = base_url.clone();
        let mut cursor = runtime_state.get_updates_buf.clone();
        let mut context_tokens = runtime_state.context_tokens.clone();
        let mut user_histories: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();
        let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
        let mut seen_order: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        let mut consecutive_failures = 0_u32;
        let base_info = serde_json::json!({"channel_version": "2.1.1"});

        let _ = app.emit("wechat-status", serde_json::json!({"status": "connected"}));

        loop {
            if stop_rx.has_changed().unwrap_or(false) && *stop_rx.borrow() {
                break;
            }

            let body = serde_json::json!({
                "get_updates_buf": cursor,
                "base_info": base_info,
            });

            let resp = match client
                .post(format!("{}/ilink/bot/getupdates", base_url))
                .headers(build_auth_headers(&token))
                .timeout(std::time::Duration::from_secs(poll_timeout_secs + 10))
                .json(&body)
                .send()
                .await
            {
                Ok(r) => {
                    if !r.status().is_success() {
                        consecutive_failures += 1;
                        let status = r.status();
                        let body = r.text().await.unwrap_or_default();
                        let _ = app.emit("wechat-status", serde_json::json!({
                            "status": "error",
                            "message": format!("HTTP {status}: {body}")
                        }));
                        let delay = if consecutive_failures >= WECHAT_MAX_CONSECUTIVE_FAILURES {
                            consecutive_failures = 0;
                            WECHAT_BACKOFF_DELAY_SECS
                        } else {
                            WECHAT_RETRY_DELAY_SECS
                        };
                        if sleep_or_stop(&stop_rx, std::time::Duration::from_secs(delay)).await {
                            break;
                        }
                        continue;
                    }
                    r
                }
                Err(e) => {
                    if e.is_timeout() {
                        continue;
                    }
                    consecutive_failures += 1;
                    let delay = if consecutive_failures >= WECHAT_MAX_CONSECUTIVE_FAILURES {
                        consecutive_failures = 0;
                        WECHAT_BACKOFF_DELAY_SECS
                    } else {
                        WECHAT_RETRY_DELAY_SECS
                    };
                    let _ = app.emit("wechat-status", serde_json::json!({
                        "status": "error",
                        "message": format!("轮询失败: {e}")
                    }));
                    if sleep_or_stop(&stop_rx, std::time::Duration::from_secs(delay)).await {
                        break;
                    }
                    continue;
                }
            };

            let data: Value = match resp.json().await {
                Ok(d) => {
                    consecutive_failures = 0;
                    d
                }
                Err(e) => {
                    consecutive_failures += 1;
                    let delay = if consecutive_failures >= WECHAT_MAX_CONSECUTIVE_FAILURES {
                        consecutive_failures = 0;
                        WECHAT_BACKOFF_DELAY_SECS
                    } else {
                        WECHAT_RETRY_DELAY_SECS
                    };
                    let _ = app.emit("wechat-status", serde_json::json!({
                        "status": "error",
                        "message": format!("解析轮询响应失败: {e}")
                    }));
                    if sleep_or_stop(&stop_rx, std::time::Duration::from_secs(delay)).await {
                        break;
                    }
                    continue;
                }
            };

            // Check errors
            let errcode = data.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
            let ret = data.get("ret").and_then(|v| v.as_i64()).unwrap_or(0);
            if errcode != 0 || ret != 0 {
                if errcode == WECHAT_SESSION_EXPIRED || ret == WECHAT_SESSION_EXPIRED {
                    let _ = app.emit("wechat-status", serde_json::json!({
                        "status": "error",
                        "message": "微信会话已过期，已暂停轮询，请重新扫码登录"
                    }));
                    if sleep_or_stop(
                        &stop_rx,
                        std::time::Duration::from_secs(WECHAT_SESSION_PAUSE_SECS),
                    ).await {
                        break;
                    }
                    continue;
                }

                consecutive_failures += 1;
                let _ = app.emit("wechat-status", serde_json::json!({
                    "status": "error",
                    "message": format!("errcode={errcode}, ret={ret}")
                }));
                let delay = if consecutive_failures >= WECHAT_MAX_CONSECUTIVE_FAILURES {
                    consecutive_failures = 0;
                    WECHAT_BACKOFF_DELAY_SECS
                } else {
                    WECHAT_RETRY_DELAY_SECS
                };
                if sleep_or_stop(&stop_rx, std::time::Duration::from_secs(delay)).await {
                    break;
                }
                continue;
            }

            if let Some(timeout_ms) = data.get("longpolling_timeout_ms").and_then(|v| v.as_u64()) {
                if timeout_ms > 0 {
                    poll_timeout_secs = std::cmp::max(timeout_ms / 1000, 5);
                }
            }

            // Update cursor
            if let Some(buf) = data.get("get_updates_buf").and_then(|v| v.as_str()) {
                if !buf.is_empty() {
                    cursor = buf.to_string();
                    runtime_state.get_updates_buf = cursor.clone();
                    let _ = save_wechat_runtime_state(&runtime_state);
                }
            }

            // Process messages
            let msgs = data.get("msgs").and_then(|v| v.as_array());
            if let Some(msgs) = msgs {
                for msg in msgs {
                    // Skip bot messages (type 2)
                    if msg.get("message_type").and_then(|v| v.as_i64()) == Some(2) {
                        continue;
                    }

                    if let Some(msg_id) = wechat_message_id(msg) {
                        if !remember_wechat_message(&mut seen_ids, &mut seen_order, msg_id) {
                            continue;
                        }
                    }

                    let from_user = msg
                        .get("from_user_id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if from_user.is_empty() {
                        continue;
                    }

                    // Cache context_token
                    if let Some(ct) = msg.get("context_token").and_then(|v| v.as_str()) {
                        if !ct.is_empty() {
                            context_tokens.insert(from_user.to_string(), ct.to_string());
                            runtime_state.context_tokens = context_tokens.clone();
                            let _ = save_wechat_runtime_state(&runtime_state);
                        }
                    }

                    // Extract text
                    let mut text = String::new();
                    if let Some(items) = msg.get("item_list").and_then(|v| v.as_array()) {
                        for item in items {
                            if item.get("type").and_then(|v| v.as_i64()) == Some(1) {
                                if let Some(t) = item
                                    .get("text_item")
                                    .and_then(|ti| ti.get("text"))
                                    .and_then(|v| v.as_str())
                                {
                                    text = t.to_string();
                                    break;
                                }
                            }
                        }
                    }

                    if !text.is_empty() {
                        let _ = app.emit("wechat-message", serde_json::json!({
                            "from": from_user,
                            "text": text,
                        }));

                        let ctx_token = context_tokens.get(from_user).cloned().unwrap_or_default();

                        // 1. Reply "正在思考..." immediately
                        let thinking_body = serde_json::json!({
                            "msg": {
                                "from_user_id": "",
                                "to_user_id": from_user,
                                "client_id": format!("webot-{}", &uuid::Uuid::new_v4().to_string()[..12]),
                                "message_type": 2,
                                "message_state": 2,
                                "item_list": [{"type": 1, "text_item": {"text": "正在思考..."}}],
                                "context_token": &ctx_token,
                            },
                            "base_info": &base_info,
                        });
                        let _ = client
                            .post(format!("{}/ilink/bot/sendmessage", base_url))
                            .headers(build_auth_headers(&token))
                            .json(&thinking_body)
                            .send()
                            .await;

                        // 2. Send typing indicator
                        let typing_ticket = match client
                            .post(format!("{}/ilink/bot/getconfig", base_url))
                            .headers(build_auth_headers(&token))
                            .json(&serde_json::json!({
                                "ilink_user_id": from_user,
                                "context_token": ctx_token,
                                "base_info": &base_info,
                            }))
                            .send().await
                        {
                            Ok(r) => r.json::<Value>().await.ok().and_then(|d| d.get("typing_ticket").and_then(|v| v.as_str()).map(String::from)).unwrap_or_default(),
                            Err(_) => String::new(),
                        };
                        if !typing_ticket.is_empty() {
                            let _ = client
                                .post(format!("{}/ilink/bot/sendtyping", base_url))
                                .headers(build_auth_headers(&token))
                                .json(&serde_json::json!({
                                    "ilink_user_id": from_user,
                                    "typing_ticket": &typing_ticket,
                                    "status": 1,
                                    "base_info": &base_info,
                                }))
                                .send().await;
                        }

                        // 3. Call LLM
                        let history = user_histories.entry(from_user.to_string()).or_default();
                        history.push(serde_json::json!({"role": "user", "content": text}));
                        let start = if history.len() > max_context { history.len() - max_context } else { 0 };
                        let mut llm_msgs = vec![serde_json::json!({"role": "system", "content": &system_prompt})];
                        llm_msgs.extend(history[start..].to_vec());

                        let reply = match crate::llm::call_llm(&provider_config, &llm_msgs).await {
                            Ok(r) => r,
                            Err(e) => format!("AI 回复失败: {e}"),
                        };

                        // 4. Cancel typing
                        if !typing_ticket.is_empty() {
                            let _ = client
                                .post(format!("{}/ilink/bot/sendtyping", base_url))
                                .headers(build_auth_headers(&token))
                                .json(&serde_json::json!({
                                    "ilink_user_id": from_user,
                                    "typing_ticket": &typing_ticket,
                                    "status": 2,
                                    "base_info": &base_info,
                                }))
                                .send().await;
                        }

                        // 5. Parse [media: ...] markers and send reply + media
                        let (clean_text, media_files) = parse_media_markers(&reply);
                        history.push(serde_json::json!({"role": "assistant", "content": &reply}));

                        if !clean_text.is_empty() {
                            let reply_body = serde_json::json!({
                                "msg": {
                                    "from_user_id": "",
                                    "to_user_id": from_user,
                                    "client_id": format!("webot-{}", &uuid::Uuid::new_v4().to_string()[..12]),
                                    "message_type": 2,
                                    "message_state": 2,
                                    "item_list": [{"type": 1, "text_item": {"text": clean_text}}],
                                    "context_token": &ctx_token,
                                },
                                "base_info": &base_info,
                            });
                            let _ = client
                                .post(format!("{}/ilink/bot/sendmessage", base_url))
                                .headers(build_auth_headers(&token))
                                .json(&reply_body)
                                .send()
                                .await;
                        }

                        for filename in media_files {
                            if let Some(ref dir) = media_dir {
                                let file_path = std::path::Path::new(dir).join(&filename);
                                let _ = crate::media::send_media_file(
                                    &client,
                                    &base_url,
                                    &build_auth_headers(&token),
                                    from_user,
                                    &ctx_token,
                                    &file_path.to_string_lossy(),
                                    &base_info,
                                ).await;
                            }
                        }
                    }
                }
            }
        }

        let _ = app.emit("wechat-status", serde_json::json!({"status": "disconnected"}));
    });

    *state.wechat_poll_handle.lock().unwrap() = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: crate::config::Settings,
) -> Result<(), String> {
    crate::config::save_settings(&settings)?;
    *state.settings.lock().unwrap() = settings;
    Ok(())
}

#[tauri::command]
pub fn stop_wechat_listener(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(tx) = state.wechat_stop_tx.lock().unwrap().take() {
        let _ = tx.send(true);
    }
    if let Some(handle) = state.wechat_poll_handle.lock().unwrap().take() {
        handle.abort();
    }
    Ok(())
}

#[tauri::command]
pub async fn send_media(
    state: State<'_, AppState>,
    to_user_id: String,
    file_path: String,
) -> Result<(), String> {
    let settings = state.settings.lock().unwrap().clone();
    let token = settings.wechat.token.clone();
    let base_url = settings.wechat.base_url.clone();
    if token.is_empty() {
        return Err("WeChat 未登录".into());
    }

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let auth_headers = build_auth_headers(&token);
    let base_info = serde_json::json!({"channel_version": "2.1.1"});

    crate::media::send_media_file(
        &client,
        &base_url,
        &auth_headers,
        &to_user_id,
        "",
        &file_path,
        &base_info,
    )
    .await
}
