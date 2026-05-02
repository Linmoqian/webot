use futures_util::future::join_all;
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

        let context_snapshot = discussion.clone();
        let tasks: Vec<_> = roles.iter().map(|role| {
            let role = role.clone();
            let topic = topic.clone();
            let context_snapshot = context_snapshot.clone();
            let config = config.clone();
            let app = app.clone();

            async move {
                let prompt = format!(
                    "你是{role}，正在参加关于「{topic}」的圆桌讨论。\
                    请基于你的专业领域发表观点。以下是目前的讨论记录：\n\n{context_snapshot}\n\n\
                    请用200字以内发表你的观点，直接说内容，不要说'我认为'等开场白。"
                );

                let messages = vec![
                    json!({ "role": "system", "content": prompt }),
                    json!({ "role": "user", "content": format!("请{role}就「{topic}」发表第{round}轮观点") }),
                ];

                let base_payload = json!({ "round": round, "role": &role });

                let _ = app.emit(
                    "roundtable-speaker",
                    json!({ "round": round, "role": &role, "status": "start" }),
                );

                match crate::llm::stream_llm(&config, &messages, &app, "roundtable-speaker", base_payload).await {
                    Ok(content) => {
                        let _ = app.emit(
                            "roundtable-speaker",
                            json!({ "round": round, "role": &role, "status": "done", "content": &content }),
                        );
                        (role, content)
                    }
                    Err(e) => (role, format!("（发言失败：{e}）")),
                }
            }
        }).collect();

        let results = join_all(tasks).await;
        for (role, content) in results {
            discussion.push_str(&format!("**{role}**：{content}\n\n"));
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_weather_def_has_name() {
        let def = weather_def();
        assert_eq!(def["function"]["name"].as_str(), Some("weather"));
    }

    #[test]
    fn test_roundtable_def_has_name() {
        let def = roundtable_def();
        assert_eq!(def["function"]["name"].as_str(), Some("roundtable"));
    }

    #[test]
    fn test_builtin_tool_def_known() {
        assert!(builtin_tool_def("weather").is_some());
        assert!(builtin_tool_def("roundtable").is_some());
    }

    #[test]
    fn test_builtin_tool_def_unknown() {
        assert!(builtin_tool_def("custom_tool").is_none());
    }

    #[test]
    fn test_is_builtin() {
        assert!(is_builtin("weather"));
        assert!(is_builtin("roundtable"));
        assert!(!is_builtin("other"));
    }

    #[test]
    fn test_execute_weather() {
        let result = execute_weather(json!({"city": "北京"}));
        let parsed: Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["city"].as_str(), Some("北京"));
        assert!(parsed["temperature"].as_str().unwrap().ends_with("°C"));
        assert!(parsed["condition"].as_str().is_some());
        assert!(parsed["humidity"].as_str().unwrap().ends_with('%'));
    }

    #[test]
    fn test_execute_weather_deterministic() {
        let a = execute_weather(json!({"city": "上海"}));
        let b = execute_weather(json!({"city": "上海"}));
        assert_eq!(a, b);
    }

    #[test]
    fn test_get_tool_definitions_builtin() {
        let defs = get_tool_definitions(
            &["weather".to_string(), "roundtable".to_string()],
            &[],
        );
        assert_eq!(defs.len(), 2);
    }

    #[test]
    fn test_get_tool_definitions_unknown_ignored() {
        let defs = get_tool_definitions(&["unknown".to_string()], &[]);
        assert!(defs.is_empty());
    }

    #[test]
    fn test_get_tool_definitions_plugin() {
        let plugin = PluginManifest {
            id: "my-tool".to_string(),
            name: crate::plugins::LocalizedText {
                zh: "测试".to_string(),
                en: "Test".to_string(),
            },
            description: crate::plugins::LocalizedText {
                zh: "描述".to_string(),
                en: "Desc".to_string(),
            },
            version: "1.0".to_string(),
            author: "test".to_string(),
            icon: "code".to_string(),
            plugin_type: "remote".to_string(),
            tool: json!({"type":"function","function":{"name":"my_tool","parameters":{}}}),
            endpoint: Some("http://localhost".to_string()),
            lab: None,
            slots: None,
        };
        let defs = get_tool_definitions(&["my-tool".to_string()], &[plugin]);
        assert_eq!(defs.len(), 1);
        assert_eq!(defs[0]["function"]["name"].as_str(), Some("my_tool"));
    }
}
