use std::path::Path;

use tauri::{AppHandle, Emitter};

use crate::installer::install::{
    install_skill_from_git, install_skill_from_git_with_source, install_skill_from_path,
    read_provenance,
};
use crate::installer::uninstall::{
    uninstall_skill as uninstall_skill_impl,
    uninstall_skill_from_all as uninstall_skill_from_all_impl,
};
use crate::installer::update as updater;
use crate::models::agent::AgentConfig;
use crate::models::skill::{Skill, SkillSource, UpdateAllResult};
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};
use crate::scanner::engine::scan_all_skills as scan_all_skills_impl;

fn load_detected_agents() -> Result<Vec<AgentConfig>, String> {
    let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
    Ok(detect_agents(&configs))
}

#[tauri::command]
pub async fn scan_all_skills() -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let agents = load_detected_agents()?;
        scan_all_skills_impl(&agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn scan_agent_skills(agent_slug: String) -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        let all = scan_all_skills_impl(&agents).map_err(|e| e.to_string())?;
        Ok(all
            .into_iter()
            .filter(|s| s.installations.iter().any(|i| i.agent_slug == agent_slug))
            .collect())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn install_skill(source: SkillSource, target_agents: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if target_agents.iter().any(|a| a == "shared") {
            return Err("Cannot install directly to the shared skills directory. Install to a specific agent instead.".to_string());
        }
        let agents = load_detected_agents()?;
        match source {
            SkillSource::LocalPath { path } => {
                let source_path = Path::new(&path).to_path_buf();
                install_skill_from_path(&source_path, &target_agents, &agents)
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::GitRepository {
                repo_url,
                skill_path,
            } => {
                let relative = skill_path.unwrap_or_else(|| ".".to_string());
                install_skill_from_git(&repo_url, &relative, &target_agents, &agents)
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::SkillsSh { repository } => {
                let repo = repository.ok_or_else(|| "repository url is required".to_string())?;
                install_skill_from_git_with_source(&repo, ".", &target_agents, &agents, "skills.sh")
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::ClawHub { repository } => {
                let repo = repository.ok_or_else(|| "repository url is required".to_string())?;
                install_skill_from_git_with_source(&repo, ".", &target_agents, &agents, "clawhub")
                    .map_err(|e| e.to_string())?;
                Ok(())
            }
            SkillSource::Unknown => Err("unsupported skill source".to_string()),
        }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_skill(skill_id: String, agent_slug: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if agent_slug == "shared" {
            return Err("Cannot uninstall from the shared skills directory directly. Uninstall from the specific agent instead.".to_string());
        }
        let agents = load_detected_agents()?;
        uninstall_skill_impl(&skill_id, &agent_slug, &agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn uninstall_skill_all(skill_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        uninstall_skill_from_all_impl(&skill_id, &agents).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn sync_skill(skill_id: String, target_agents: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if target_agents.iter().any(|a| a == "shared") {
            return Err("Cannot sync to the shared skills directory. Sync to a specific agent instead.".to_string());
        }
        let agents = load_detected_agents()?;
        let source = resolve_skill_source(&skill_id, &agents)?;
        install_skill_from_path(&source, &target_agents, &agents).map_err(|e| e.to_string())?;
        // Preserve provenance: install_skill_from_path copies to canonical but does not
        // touch the provenance registry, so any existing provenance entry for this
        // skill_id is automatically retained. If the skill was only in an agent dir
        // (not canonical) and had no provenance, there is nothing to preserve.
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Update a single skill from its upstream git repository.
#[tauri::command]
pub async fn update_skill(skill_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        let provenance = read_provenance();
        let entry = provenance
            .get(&skill_id)
            .ok_or_else(|| format!("No provenance for skill '{skill_id}'"))?;

        let source_label = entry.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let repo_url = entry
            .get("repository")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("Skill '{skill_id}' has no repository URL"))?;
        let skill_path = entry.get("skill_path").and_then(|v| v.as_str());

        let all_skills = scan_all_skills_impl(&agents).map_err(|e| e.to_string())?;
        let target_agents: Vec<String> = all_skills
            .iter()
            .find(|s| s.id == skill_id)
            .map(|s| s.all_agents())
            .unwrap_or_default();

        let session = updater::RepoSession::open(repo_url).map_err(|e| e.to_string())?;
        updater::update_skill(
            &skill_id,
            source_label,
            repo_url,
            skill_path,
            &target_agents,
            &agents,
            &session,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Update all skills that have an upstream git repository.
#[tauri::command]
pub async fn update_all_skills(app: AppHandle) -> Result<UpdateAllResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agents = load_detected_agents()?;
        Ok(updater::update_all(&agents, |progress| {
            let _ = app.emit("skill-update-progress", &progress);
        }))
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Find the actual source directory for a skill by id.
/// Checks canonical location first, then falls back to agent directories.
fn resolve_skill_source(
    skill_id: &str,
    agents: &[AgentConfig],
) -> Result<std::path::PathBuf, String> {
    // 1. Check canonical ~/.agents/skills/<id>/
    let canonical = crate::installer::install::shared_skills_dir().join(skill_id);
    if canonical.is_dir() {
        return Ok(canonical);
    }
    // 2. Fall back: search agent directories
    for agent in agents {
        for root in &agent.global_paths {
            let agent_skill = std::path::PathBuf::from(root).join(skill_id);
            if agent_skill.is_dir() {
                return Ok(agent_skill);
            }
        }
    }
    Err(format!("skill '{}' not found in any directory", skill_id))
}

#[tauri::command]
pub async fn read_skill_content(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized: std::path::PathBuf = path.replace('/', std::path::MAIN_SEPARATOR_STR).into();
        std::fs::read_to_string(&normalized).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn write_skill_content(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let normalized: std::path::PathBuf = path.replace('/', std::path::MAIN_SEPARATOR_STR).into();
        std::fs::write(&normalized, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn install_from_git(
    repo_url: String,
    skill_relative_path: String,
    target_agents: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if target_agents.iter().any(|a| a == "shared") {
            return Err("Cannot install directly to the shared skills directory. Install to a specific agent instead.".to_string());
        }
        let agents = load_detected_agents()?;
        install_skill_from_git(&repo_url, &skill_relative_path, &target_agents, &agents)
            .map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Fetch SKILL.md from a GitHub repository.
///
/// When `skill_name` is provided, tries `skills/{skill_name}/SKILL.md` first
/// (skills.sh mono-repo convention), then root `SKILL.md`.
#[tauri::command]
pub async fn fetch_remote_skill_content(
    repo_url: String,
    skill_name: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| e.to_string())?;

        let repo = repo_url
            .trim_end_matches('/')
            .trim_end_matches(".git")
            .to_string();

        let raw_base = repo.replace("github.com", "raw.githubusercontent.com");
        let branches = ["main", "master"];

        let mut file_paths: Vec<String> = Vec::new();
        if let Some(ref name) = skill_name {
            file_paths.push(format!("skills/{name}/SKILL.md"));
        }
        file_paths.push("SKILL.md".to_string());

        for path in &file_paths {
            for branch in &branches {
                let url = format!("{raw_base}/{branch}/{path}");
                match client.get(&url).send() {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(text) = resp.text() {
                            if !text.is_empty() {
                                return Ok(text);
                            }
                        }
                    }
                    _ => continue,
                }
            }
        }

        Err("Could not fetch SKILL.md from repository".to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}
