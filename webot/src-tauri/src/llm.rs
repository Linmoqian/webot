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

pub async fn call_llm(
    config: &ProviderConfig,
    messages: &[Value],
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout))
        .danger_accept_invalid_certs(!config.verify_ssl)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let body = serde_json::json!({
        "model": config.model,
        "messages": messages,
        "stream": false,
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

    let data: Value = response.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
    let content = data["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok(content)
}

pub async fn chat_with_tools(
    config: &ProviderConfig,
    messages: &[Value],
    tools: &[Value],
    installed_plugins: &[crate::plugins::PluginManifest],
    app: &AppHandle,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(config.timeout))
        .danger_accept_invalid_certs(!config.verify_ssl)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let mut all_messages = messages.to_vec();
    let max_rounds = 3;

    for _ in 0..max_rounds {
        let body = serde_json::json!({
            "model": config.model,
            "messages": &all_messages,
            "stream": false,
            "tools": tools,
        });

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

        let data: Value = response.json().await.map_err(|e| format!("解析响应失败: {e}"))?;
        let msg = &data["choices"][0]["message"];

        let tool_calls = msg
            .get("tool_calls")
            .and_then(|v| v.as_array())
            .filter(|arr| !arr.is_empty());

        if let Some(calls) = tool_calls {
            all_messages.push(msg.clone());

            for call in calls {
                let name = call["function"]["name"].as_str().unwrap_or("");
                let args_str = call["function"]["arguments"].as_str().unwrap_or("{}");
                let args: Value =
                    serde_json::from_str(args_str).unwrap_or_else(|_| serde_json::json!({}));

                let _ = app.emit(
                    "chat-tool-call",
                    serde_json::json!({ "name": name, "arguments": args }),
                );

                let result = crate::tools::execute_tool_async(name, args, installed_plugins).await;

                all_messages.push(serde_json::json!({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": result,
                }));
            }
            continue;
        }

        let content = msg["content"].as_str().unwrap_or("").to_string();
        if !content.is_empty() {
            let _ = app.emit(
                "chat-text",
                serde_json::json!({ "content": &content }),
            );
        }
        return Ok(content);
    }

    Err("工具调用超过最大轮次限制 (3)".into())
}
