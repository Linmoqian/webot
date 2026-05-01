use serde_json::{json, Value};

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

fn builtin_tool_def(id: &str) -> Option<Value> {
    match id {
        "weather" => Some(weather_def()),
        _ => None,
    }
}

fn is_builtin(id: &str) -> bool {
    matches!(id, "weather")
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
) -> String {
    if is_builtin(name) {
        return execute_tool(name, args);
    }
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
