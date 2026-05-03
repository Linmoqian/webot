mod commands;
mod config;
mod llm;
mod media;
mod plugins;
mod task;
mod tools;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::{
                menu::{MenuBuilder, MenuItemBuilder},
                tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                Manager,
            };

            // Set config dir to user-writable app data directory
            if let Ok(data_dir) = app.path().app_data_dir() {
                crate::config::set_config_dir(data_dir);
            }

            let settings = crate::config::load_settings();

            app.manage(AppState {
                messages: std::sync::Mutex::new(Vec::new()),
                settings: std::sync::Mutex::new(settings),
                wechat_poll_handle: std::sync::Mutex::new(None),
                wechat_stop_tx: std::sync::Mutex::new(None),
                task_runtime: crate::task::TaskRuntime::new(),
            });

            let show_item = MenuItemBuilder::with_id("show", "显示主窗口").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Webot")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
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
            commands::fetch_marketplace,
            commands::get_installed_plugins,
            commands::install_plugin,
            commands::uninstall_plugin,
            commands::start_roundtable,
            commands::list_tasks,
            commands::cancel_task,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
