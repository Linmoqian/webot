use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderConfig {
    #[serde(default = "default_base_url")]
    pub base_url: String,
    #[serde(default = "default_api_key")]
    pub api_key: String,
    #[serde(default = "default_model")]
    pub model: String,
    #[serde(default)]
    pub verify_ssl: bool,
    #[serde(default = "default_timeout")]
    pub timeout: u64,
}

fn default_base_url() -> String {
    "http://localhost:11434/v1".into()
}

fn default_api_key() -> String {
    "ollama".into()
}

fn default_model() -> String {
    "gemma4:e2b".into()
}

fn default_timeout() -> u64 {
    60
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self {
            base_url: default_base_url(),
            api_key: default_api_key(),
            model: default_model(),
            verify_ssl: false,
            timeout: default_timeout(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    #[serde(default = "default_system_prompt")]
    pub system_prompt: String,
    #[serde(default = "default_max_messages")]
    pub max_context_messages: usize,
}

fn default_system_prompt() -> String {
    "You are a helpful assistant.".into()
}

fn default_max_messages() -> usize {
    20
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            system_prompt: default_system_prompt(),
            max_context_messages: default_max_messages(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WechatConfig {
    #[serde(default = "default_wechat_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub media_dir: Option<String>,
}

fn default_wechat_base_url() -> String {
    "https://ilinkai.weixin.qq.com".into()
}

impl Default for WechatConfig {
    fn default() -> Self {
        Self {
            base_url: default_wechat_base_url(),
            token: String::new(),
            media_dir: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub provider: ProviderConfig,
    #[serde(default)]
    pub agent: AgentConfig,
    #[serde(default)]
    pub wechat: WechatConfig,
}

fn find_config() -> Option<std::path::PathBuf> {
    let candidates: Vec<std::path::PathBuf> = vec![
        std::env::current_dir().unwrap_or_default().join("config.json"),
        std::path::PathBuf::from("../config.json"),
        std::env::current_dir().unwrap_or_default().join("../../config.json"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

pub fn load_settings() -> Settings {
    if let Some(path) = find_config() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Settings::default()
    }
}

pub fn config_path() -> Option<std::path::PathBuf> {
    find_config()
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = config_path().ok_or("config.json 未找到")?;
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())
}
