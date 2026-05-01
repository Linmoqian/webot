mod commands;
mod config;
mod llm;
mod media;
mod tools;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings = config::load_settings();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            messages: std::sync::Mutex::new(Vec::new()),
            settings: std::sync::Mutex::new(settings),
            wechat_poll_handle: std::sync::Mutex::new(None),
            wechat_stop_tx: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_chat,
            commands::get_settings,
            commands::update_settings,
            commands::fetch_wechat_qr,
            commands::poll_qr_status,
            commands::save_wechat_token,
            commands::start_wechat_listener,
            commands::stop_wechat_listener,
            commands::send_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
