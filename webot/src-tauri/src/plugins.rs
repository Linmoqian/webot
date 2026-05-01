use serde::{Deserialize, Serialize};
use serde_json::Value;

const MARKETPLACE_URL: &str =
    "https://raw.githubusercontent.com/Linmoqian/webot/main/marketplace/index.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalizedText {
    pub zh: String,
    pub en: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotConfig {
    pub renderer: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PluginSlots {
    #[serde(default)]
    pub tool_result: Option<SlotConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: LocalizedText,
    pub description: LocalizedText,
    pub version: String,
    pub author: String,
    pub icon: String,
    #[serde(rename = "type")]
    pub plugin_type: String,
    pub tool: Value,
    pub endpoint: Option<String>,
    #[serde(default)]
    pub lab: Option<bool>,
    #[serde(default)]
    pub slots: Option<PluginSlots>,
}

pub fn get_tool_renderer(installed: &[PluginManifest], tool_name: &str) -> Option<String> {
    installed
        .iter()
        .find(|p| {
            p.tool["function"]["name"].as_str() == Some(tool_name) || p.id == tool_name
        })
        .and_then(|p| p.slots.as_ref())
        .and_then(|s| s.tool_result.as_ref())
        .map(|c| c.renderer.clone())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceIndex {
    pub plugins: Vec<PluginManifest>,
}

fn plugins_dir() -> std::path::PathBuf {
    let base = crate::config::config_path()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
    base.join("config").join("plugins")
}

pub fn load_installed_plugins() -> Vec<PluginManifest> {
    let dir = plugins_dir();
    if !dir.exists() {
        return Vec::new();
    }
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .is_some_and(|ext| ext == "json")
        })
        .filter_map(|e| {
            let content = std::fs::read_to_string(e.path()).ok()?;
            serde_json::from_str::<PluginManifest>(&content).ok()
        })
        .collect()
}

pub fn save_plugin(manifest: &PluginManifest) -> Result<(), String> {
    let dir = plugins_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建插件目录失败: {e}"))?;
    let path = dir.join(format!("{}.json", manifest.id));
    let content =
        serde_json::to_string_pretty(manifest).map_err(|e| format!("序列化插件失败: {e}"))?;
    std::fs::write(&path, content).map_err(|e| format!("保存插件失败: {e}"))
}

pub fn remove_plugin(id: &str) -> Result<(), String> {
    let path = plugins_dir().join(format!("{id}.json"));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("删除插件失败: {e}"))?;
    }
    Ok(())
}

fn local_marketplace_path() -> Option<std::path::PathBuf> {
    let candidates: Vec<std::path::PathBuf> = if let Some(cfg) = crate::config::config_path() {
        let parent = cfg.parent()?;
        vec![
            parent.join("marketplace").join("index.json"),
            parent.join("..").join("marketplace").join("index.json"),
        ]
    } else {
        vec![]
    };
    candidates.into_iter().find(|p| p.exists())
}

fn load_local_marketplace() -> Option<MarketplaceIndex> {
    let path = local_marketplace_path()?;
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

pub async fn fetch_marketplace_index() -> Result<MarketplaceIndex, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    match client.get(MARKETPLACE_URL).send().await {
        Ok(resp) if resp.status().is_success() => {
            resp.json::<MarketplaceIndex>()
                .await
                .map_err(|e| format!("解析市场索引失败: {e}"))
        }
        _ => {
            load_local_marketplace()
                .ok_or_else(|| "远程市场不可用，本地索引未找到".to_string())
        }
    }
}

pub async fn execute_http_tool(endpoint: &str, args: Value) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let resp = client
        .post(endpoint)
        .json(&args)
        .send()
        .await
        .map_err(|e| format!("调用工具 API 失败: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("工具 API 错误 {status}: {text}"));
    }

    resp.text()
        .await
        .map_err(|e| format!("读取工具响应失败: {e}"))
}
