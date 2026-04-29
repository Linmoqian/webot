use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::watch;

pub struct AppState {
    pub messages: Mutex<Vec<Value>>,
    pub settings: Mutex<crate::config::Settings>,
    pub wechat_poll_handle: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub wechat_stop_tx: Mutex<Option<watch::Sender<bool>>>,
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
        let mut all = vec![serde_json::json!({
            "role": "system",
            "content": &settings.agent.system_prompt
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
    let token = settings.wechat.token.clone();
    if token.is_empty() {
        return Err("未登录微信，请先扫码登录".into());
    }
    let base_url = settings.wechat.base_url.clone();
    let provider_config = settings.provider.clone();
    let system_prompt = settings.agent.system_prompt.clone();
    let max_context = settings.agent.max_context_messages;

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
        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(45))
            .build()
            .unwrap();

        let mut cursor = String::new();
        let mut context_tokens: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let mut user_histories: std::collections::HashMap<String, Vec<Value>> = std::collections::HashMap::new();
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
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    continue;
                }
            };

            let data: Value = match resp.json().await {
                Ok(d) => d,
                Err(_) => {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                    continue;
                }
            };

            // Check errors
            let errcode = data.get("errcode").and_then(|v| v.as_i64()).unwrap_or(0);
            if errcode != 0 {
                let _ = app.emit("wechat-status", serde_json::json!({
                    "status": "error",
                    "message": format!("errcode={errcode}")
                }));
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            }

            // Update cursor
            if let Some(buf) = data.get("get_updates_buf").and_then(|v| v.as_str()) {
                if !buf.is_empty() {
                    cursor = buf.to_string();
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

                        // 5. Save & send AI reply
                        history.push(serde_json::json!({"role": "assistant", "content": &reply}));

                        let reply_body = serde_json::json!({
                            "msg": {
                                "from_user_id": "",
                                "to_user_id": from_user,
                                "client_id": format!("webot-{}", &uuid::Uuid::new_v4().to_string()[..12]),
                                "message_type": 2,
                                "message_state": 2,
                                "item_list": [{"type": 1, "text_item": {"text": reply}}],
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

                        // 6. Send image
                        let image_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                            .join("icons/cloud-maple-icon-transparent.png");
                        let _ = crate::media::send_media_file(
                            &client,
                            &base_url,
                            &build_auth_headers(&token),
                            from_user,
                            &ctx_token,
                            &image_path.to_string_lossy(),
                            &base_info,
                        )
                        .await;
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
