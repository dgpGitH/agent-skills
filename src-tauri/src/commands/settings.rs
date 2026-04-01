use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoEntry {
    pub repo_url: Option<String>,
    pub local_path: Option<String>,
    pub last_synced: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    pub theme: Option<String>,
    pub language: Option<String>,
    pub path_overrides: Option<HashMap<String, Vec<String>>>,
    pub repos: Option<Vec<RepoEntry>>,
    /// "minimize" | "quit" | None (ask every time)
    pub close_action: Option<String>,
}

fn settings_path() -> PathBuf {
    if let Some(home) = dirs::home_dir() {
        return home.join(".skills-app").join("config.toml");
    }
    PathBuf::from(".skills-app/config.toml")
}

#[tauri::command]
pub fn read_settings() -> Result<AppSettings, String> {
    let path = settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    toml::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = toml::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_marketplace_cache() -> Result<(), String> {
    let cache_path = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("skills-app")
        .join("marketplace.db");
    if cache_path.exists() {
        fs::remove_file(&cache_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_minimize(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn close_quit(app: tauri::AppHandle) {
    app.exit(0);
}
