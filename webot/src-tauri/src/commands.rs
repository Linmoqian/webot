use std::sync::Mutex;

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
