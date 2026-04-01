pub mod commands;
pub mod installer;
pub mod marketplace;
pub mod models;
pub mod parser;
pub mod paths;
pub mod registry;
pub mod scanner;
pub mod watcher;

#[cfg(target_os = "macos")]
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            paths::init(app.handle());
            watcher::start_skill_watcher(app.handle().clone());

            let show = MenuItemBuilder::with_id("show", "Show AgentSkills").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

            if let Some(tray) = app.tray_by_id("main-tray") {
                // macOS: use monochrome template icon that adapts to menu bar theme
                #[cfg(target_os = "macos")]
                {
                    let icon = Image::from_bytes(include_bytes!("../icons/tray-macos.png"));
                    if let Ok(icon) = icon {
                        let _ = tray.set_icon(Some(icon));
                        let _ = tray.set_icon_as_template(true);
                    }
                }
                tray.set_menu(Some(menu))?;
                tray.set_show_menu_on_left_click(false)?;
                tray.on_menu_event(move |app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                });
                tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agents::list_agents,
            commands::agents::detect_agents,
            commands::skills::scan_all_skills,
            commands::skills::scan_agent_skills,
            commands::skills::install_skill,
            commands::skills::uninstall_skill,
            commands::skills::uninstall_skill_all,
            commands::skills::sync_skill,
            commands::skills::update_skill,
            commands::skills::update_all_skills,
            commands::skills::read_skill_content,
            commands::skills::write_skill_content,
            commands::skills::install_from_git,
            commands::skills::fetch_remote_skill_content,
            commands::marketplace::fetch_skillssh,
            commands::marketplace::fetch_clawhub,
            commands::marketplace::search_marketplace,
            commands::marketplace::install_from_marketplace,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::settings::clear_marketplace_cache,
            commands::settings::close_minimize,
            commands::settings::close_quit,
            commands::repos::add_skill_repo,
            commands::repos::add_local_dir,
            commands::repos::remove_skill_repo,
            commands::repos::list_skill_repos,
            commands::repos::sync_skill_repo,
            commands::repos::list_repo_skills,
            commands::repos::install_repo_skill,
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let settings = commands::settings::read_settings().unwrap_or_default();
                match settings.close_action.as_deref() {
                    Some("minimize") => {
                        let _ = window.hide();
                    }
                    Some("quit") => {
                        window.app_handle().exit(0);
                    }
                    _ => {
                        // No preference saved — ask the frontend
                        let _ = window.emit("close-requested", ());
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
