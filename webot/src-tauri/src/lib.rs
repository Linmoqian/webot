mod commands;
mod config;
mod llm;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = config::load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            messages: std::sync::Mutex::new(Vec::new()),
            settings: std::sync::Mutex::new(settings),
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_chat,
            commands::get_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
