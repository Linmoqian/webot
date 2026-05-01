use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::config::ProviderConfig;
use crate::plugins::PluginManifest;

fn weather_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "weather",
            "description": "获取指定城市的天气信息，包括温度、天气状况、湿度和风力",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如：北京、上海"
                    }
                },
                "required": ["city"]
            }
        }
    })
}

fn roundtable_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "roundtable",
            "description": "发起圆桌会议，多位专家角色围绕主题展开讨论。适合需要多角度分析的问题。",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "讨论主题"
                    },
                    "roles": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "参与角色列表（可选，不填则自动分配）"
                    }
                },
                "required": ["topic"]
            }
        }
    })
}

fn builtin_tool_def(id: &str) -> Option<Value> {
    match id {
        "weather" => Some(weather_def()),
        "roundtable" => Some(roundtable_def()),
        _ => None,
    }
}

fn is_builtin(id: &str) -> bool {
    matches!(id, "weather" | "roundtable")
}

pub fn get_tool_definitions(ids: &[String], installed: &[PluginManifest]) -> Vec<Value> {
    let mut defs = Vec::new();
    for id in ids {
        if let Some(def) = builtin_tool_def(id) {
            defs.push(def);
            continue;
        }
        if let Some(plugin) = installed.iter().find(|p| p.id == *id) {
            defs.push(plugin.tool.clone());
        }
    }
    defs
}

pub fn execute_tool(name: &str, args: Value) -> String {
    match name {
        "weather" => execute_weather(args),
        _ => format!("未知工具: {name}"),
    }
}

pub async fn execute_tool_async(
    name: &str,
    args: Value,
    installed: &[PluginManifest],
    config: &ProviderConfig,
    app: &AppHandle,
) -> String {
    match name {
        "roundtable" => execute_roundtable(args, config, app).await,
        _ if is_builtin(name) => execute_tool(name, args),
        _ => {
            if let Some(plugin) = installed.iter().find(|p| {
                p.tool["function"]["name"].as_str() == Some(name) || p.id == name
            }) {
                if let Some(ref endpoint) = plugin.endpoint {
                    return crate::plugins::execute_http_tool(endpoint, args)
                        .await
                        .unwrap_or_else(|e| format!("工具调用失败: {e}"));
                }
            }
            format!("未知工具: {name}")
        }
    }
}

pub async fn execute_roundtable(
    args: Value,
    config: &ProviderConfig,
    app: &AppHandle,
) -> String {
    let topic = args["topic"].as_str().unwrap_or("").to_string();
    if topic.is_empty() {
        return "请提供讨论主题".to_string();
    }

    let roles: Vec<String> = args
        .get("roles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let roles = if roles.is_empty() {
        generate_roles(&topic, config).await
    } else {
        roles
    };

    if roles.is_empty() {
        return "无法生成讨论角色".to_string();
    }

    let max_rounds = 2;
    let mut discussion = String::new();
    discussion.push_str(&format!("## 圆桌会议：{topic}\n\n"));
    discussion.push_str(&format!("**参与专家**：{}\n\n---\n\n", roles.join("、")));

    for round in 1..=max_rounds {
        discussion.push_str(&format!("### 第 {round} 轮\n\n"));

        for role in &roles {
            let prompt = format!(
                "你是{role}，正在参加关于「{topic}」的圆桌讨论。\
                请基于你的专业领域发表观点。以下是目前的讨论记录：\n\n{discussion}\n\n\
                请用200字以内发表你的观点，直接说内容，不要说'我认为'等开场白。"
            );

            let messages = vec![
                json!({ "role": "system", "content": prompt }),
                json!({ "role": "user", "content": format!("请{role}就「{topic}」发表第{round}轮观点") }),
            ];

            let base_payload = json!({ "round": round, "role": role });

            let _ = app.emit(
                "roundtable-speaker",
                json!({ "round": round, "role": role, "status": "start" }),
            );

            match crate::llm::stream_llm(config, &messages, app, "roundtable-speaker", base_payload).await {
                Ok(content) => {
                    discussion.push_str(&format!("**{role}**：{content}\n\n"));
                    let _ = app.emit(
                        "roundtable-speaker",
                        json!({ "round": round, "role": role, "status": "done", "content": content }),
                    );
                }
                Err(e) => {
                    discussion.push_str(&format!("**{role}**：（发言失败：{e}）\n\n"));
                }
            }
        }
    }

    // Summary
    let summary_prompt = format!(
        "请用简洁的要点总结以下圆桌讨论的核心观点和共识（300字以内）：\n\n{discussion}"
    );
    let summary_msgs = vec![
        json!({ "role": "system", "content": "你是一个会议纪要助手。" }),
        json!({ "role": "user", "content": summary_prompt }),
    ];

    if let Ok(summary) = crate::llm::call_llm(config, &summary_msgs).await {
        discussion.push_str(&format!("---\n\n### 总结\n\n{summary}"));
    }

    discussion
}

async fn generate_roles(topic: &str, config: &ProviderConfig) -> Vec<String> {
    let messages = vec![
        json!({ "role": "system", "content": "你是一个助手，根据讨论主题推荐合适的专家角色。只返回JSON数组，不要其他文字。" }),
        json!({ "role": "user", "content": format!("请为讨论主题「{topic}」推荐3-4位不同领域的专家角色，返回JSON数组，如：[\"架构师\", \"产品经理\", \"安全专家\"]") }),
    ];

    match crate::llm::call_llm(config, &messages).await {
        Ok(resp) => {
            let cleaned = resp
                .trim()
                .trim_start_matches("```json")
                .trim_start_matches("```")
                .trim_end_matches("```")
                .trim();
            serde_json::from_str::<Vec<String>>(cleaned).unwrap_or_else(|_| {
                vec!["专家A".to_string(), "专家B".to_string(), "专家C".to_string()]
            })
        }
        Err(_) => vec!["专家A".to_string(), "专家B".to_string(), "专家C".to_string()],
    }
}

fn execute_weather(args: Value) -> String {
    let city = args["city"].as_str().unwrap_or("未知城市");
    let conditions = ["晴", "多云", "阴", "小雨", "大雨", "雷阵雨"];
    let cond = conditions[city.len() % conditions.len()];
    let temp = 15 + (city.len() * 7) % 20;
    let humidity = 30 + (city.len() * 13) % 50;
    let winds = ["东风", "南风", "西风", "北风", "东北风", "西南风"];
    let wind = winds[city.len() % winds.len()];
    let level = 1 + city.len() % 5;

    json!({
        "city": city,
        "temperature": format!("{temp}°C"),
        "condition": cond,
        "humidity": format!("{humidity}%"),
        "wind": format!("{wind} {level}级"),
    })
    .to_string()
}
