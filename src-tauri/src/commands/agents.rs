use crate::models::agent::AgentConfig;
use crate::paths;
use crate::registry::loader::{
    detect_agents as detect_agents_impl, load_agent_configs, shared_agent_config,
};

#[tauri::command]
pub async fn list_agents() -> Result<Vec<AgentConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut agents = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
        // Always include the virtual shared agent
        agents.push(shared_agent_config());
        agents.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(agents)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn detect_agents() -> Result<Vec<AgentConfig>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
        let mut agents = detect_agents_impl(&configs);
        // Ensure the shared agent is always present (detect_agents_impl already
        // appends it via shared_agent_config(), but we guarantee uniqueness here)
        if !agents.iter().any(|a| a.slug == "shared") {
            agents.push(shared_agent_config());
        }
        Ok(agents)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}
