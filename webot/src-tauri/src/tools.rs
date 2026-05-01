use serde_json::{json, Value};

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

fn search_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "search",
            "description": "搜索引擎查询，返回相关的网页搜索结果",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "搜索关键词"
                    }
                },
                "required": ["query"]
            }
        }
    })
}

fn code_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "code",
            "description": "执行代码并返回运行结果，支持多种编程语言",
            "parameters": {
                "type": "object",
                "properties": {
                    "language": {
                        "type": "string",
                        "description": "编程语言，如 python、javascript、rust",
                        "enum": ["python", "javascript", "rust", "go", "java"]
                    },
                    "code": {
                        "type": "string",
                        "description": "要执行的代码"
                    }
                },
                "required": ["language", "code"]
            }
        }
    })
}

fn translate_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "translate",
            "description": "将文本翻译为指定语言",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "要翻译的文本"
                    },
                    "target_lang": {
                        "type": "string",
                        "description": "目标语言，如 zh、en、ja、ko、fr、de",
                        "enum": ["zh", "en", "ja", "ko", "fr", "de", "es", "ru"]
                    }
                },
                "required": ["text", "target_lang"]
            }
        }
    })
}

fn news_def() -> Value {
    json!({
        "type": "function",
        "function": {
            "name": "news",
            "description": "获取最新新闻资讯，可按主题筛选",
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "新闻主题或关键词，如：科技、体育、财经"
                    }
                }
            }
        }
    })
}

pub fn get_tool_definitions(ids: &[String]) -> Vec<Value> {
    let mut defs = Vec::new();
    for id in ids {
        let def = match id.as_str() {
            "weather" => weather_def(),
            "search" => search_def(),
            "code" => code_def(),
            "translate" => translate_def(),
            "news" => news_def(),
            _ => continue,
        };
        defs.push(def);
    }
    defs
}

pub fn execute_tool(name: &str, args: Value) -> String {
    match name {
        "weather" => execute_weather(args),
        "search" => execute_search(args),
        "code" => execute_code(args),
        "translate" => execute_translate(args),
        "news" => execute_news(args),
        _ => format!("未知工具: {name}"),
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

fn execute_search(args: Value) -> String {
    let query = args["query"].as_str().unwrap_or("");
    json!({
        "query": query,
        "results": [
            { "title": format!("{query} - 详细介绍"), "snippet": format!("关于{query}的详细信息和相关内容..."), "url": "https://example.com/1" },
            { "title": format!("{query} - 最新动态"), "snippet": format!("{query}领域的最新发展和趋势..."), "url": "https://example.com/2" },
            { "title": format!("{query} - 深度分析"), "snippet": format!("对{query}的深入分析和专业解读..."), "url": "https://example.com/3" },
        ]
    })
    .to_string()
}

fn execute_code(args: Value) -> String {
    let language = args["language"].as_str().unwrap_or("unknown");
    let code = args["code"].as_str().unwrap_or("");
    json!({
        "language": language,
        "output": format!("({language} 模拟执行) 程序运行完成，代码长度: {} 字符", code.len()),
        "exit_code": 0,
        "execution_time": "0.05s"
    })
    .to_string()
}

fn execute_translate(args: Value) -> String {
    let text = args["text"].as_str().unwrap_or("");
    let target = args["target_lang"].as_str().unwrap_or("en");
    let translated = format!("[翻译结果: {text} → {target}]");
    json!({
        "original": text,
        "translated": translated,
        "source_lang": "auto",
        "target_lang": target,
    })
    .to_string()
}

fn execute_news(args: Value) -> String {
    let topic = args["topic"].as_str().unwrap_or("综合");
    json!({
        "topic": topic,
        "articles": [
            { "title": format!("{topic}领域迎来重大突破"), "source": "示例新闻", "date": "2026-05-01" },
            { "title": format!("专家解读{topic}发展趋势"), "source": "科技日报", "date": "2026-05-01" },
            { "title": format!("{topic}行业年度报告发布"), "source": "新华社", "date": "2026-04-30" },
        ]
    })
    .to_string()
}
