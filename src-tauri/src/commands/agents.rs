use crate::models::agent::AgentConfig;
use crate::paths;
use crate::registry::loader::{detect_agents as detect_agents_impl, load_agent_configs};

#[tauri::command]
pub async fn list_agents() -> Result<Vec<AgentConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn detect_agents() -> Result<Vec<AgentConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
        Ok(detect_agents_impl(&configs))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}
