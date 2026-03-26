use std::path::Path;

use reqwest::blocking::Client;

use crate::installer::install::{install_skill_from_git, install_skill_from_git_with_source, install_skill_from_path};
use crate::installer::uninstall::{
    uninstall_skill as uninstall_skill_impl,
    uninstall_skill_from_all as uninstall_skill_from_all_impl,
};
use crate::models::agent::AgentConfig;
use crate::models::skill::{Skill, SkillSource};
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};
use crate::scanner::engine::scan_all_skills as scan_all_skills_impl;

fn load_detected_agents() -> Result<Vec<AgentConfig>, String> {
    let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
    Ok(detect_agents(&configs))
}

#[tauri::command]
pub fn scan_all_skills() -> Result<Vec<Skill>, String> {
    let agents = load_detected_agents()?;
    scan_all_skills_impl(&agents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn scan_agent_skills(agent_slug: String) -> Result<Vec<Skill>, String> {
    let agents = load_detected_agents()?;
    let all = scan_all_skills_impl(&agents).map_err(|e| e.to_string())?;
    Ok(all
        .into_iter()
        .filter(|s| s.installations.iter().any(|i| i.agent_slug == agent_slug))
        .collect())
}

#[tauri::command]
pub fn install_skill(source: SkillSource, target_agents: Vec<String>) -> Result<(), String> {
    let agents = load_detected_agents()?;
    match source {
        SkillSource::LocalPath { path } => {
            let source_path = Path::new(&path);
            install_skill_from_path(source_path, &target_agents, &agents)
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
}

#[tauri::command]
pub fn uninstall_skill(skill_id: String, agent_slug: String) -> Result<(), String> {
    let agents = load_detected_agents()?;
    uninstall_skill_impl(&skill_id, &agent_slug, &agents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn uninstall_skill_all(skill_id: String) -> Result<(), String> {
    let agents = load_detected_agents()?;
    uninstall_skill_from_all_impl(&skill_id, &agents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn sync_skill(skill_id: String, target_agents: Vec<String>) -> Result<(), String> {
    let agents = load_detected_agents()?;
    let source = resolve_skill_source(&skill_id, &agents)?;
    install_skill_from_path(&source, &target_agents, &agents).map_err(|e| e.to_string())?;
    Ok(())
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
pub fn read_skill_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_skill_content(path: String, content: String) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_from_git(
    repo_url: String,
    skill_relative_path: String,
    target_agents: Vec<String>,
) -> Result<(), String> {
    let agents = load_detected_agents()?;
    install_skill_from_git(&repo_url, &skill_relative_path, &target_agents, &agents)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetch SKILL.md from a GitHub repository.
///
/// When `skill_name` is provided, tries `skills/{skill_name}/SKILL.md` first
/// (skills.sh mono-repo convention), then root `SKILL.md`.
#[tauri::command]
pub fn fetch_remote_skill_content(
    repo_url: String,
    skill_name: Option<String>,
) -> Result<String, String> {
    let client = Client::builder()
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
}
