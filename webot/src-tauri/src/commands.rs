use std::sync::Mutex;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub messages: Mutex<Vec<Value>>,
    pub settings: Mutex<crate::config::Settings>,
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
