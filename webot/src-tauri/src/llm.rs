use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::config::ProviderConfig;

pub async fn stream_and_emit(
    config: &ProviderConfig,
    messages: &[Value],
    app: &AppHandle,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout))
        .danger_accept_invalid_certs(!config.verify_ssl)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let body = serde_json::json!({
        "model": config.model,
        "messages": messages,
        "stream": true,
    });

    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求 LLM API 失败: {e}"))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("LLM API 错误 {status}: {text}"));
    }

    let mut stream = response.bytes_stream();
    let mut full_response = String::new();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取流失败: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));

        let lines: Vec<&str> = buffer.split('\n').collect();
        let remainder = lines.last().unwrap_or(&"").to_string();

        for line in &lines[..lines.len().saturating_sub(1)] {
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" {
                    return Ok(full_response);
                }
                if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                    let delta = &parsed["choices"][0]["delta"];
                    if let Some(reasoning) = delta["reasoning_content"].as_str()
                        .or_else(|| delta["reasoning"].as_str())
                    {
                        let _ = app.emit("chat-thinking", serde_json::json!({ "content": reasoning }));
                    }
                    if let Some(content) = delta["content"].as_str() {
                        full_response.push_str(content);
                        let _ = app.emit("chat-text", serde_json::json!({ "content": content }));
                    }
                }
            }
        }
        buffer = remainder;
    }

    Ok(full_response)
}
