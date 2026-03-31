use std::collections::HashMap;
use std::path::PathBuf;

use crate::installer::install::install_skill_from_path;
use crate::marketplace::clawhub::fetch_clawhub as fetch_clawhub_impl;
use crate::marketplace::skillssh::{fetch_skillssh as fetch_skillssh_impl, search_skillssh};
use crate::marketplace::MarketplaceSkill;
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};
use crate::scanner::engine::discover_skill_dirs;

fn load_detected_agents() -> Result<Vec<crate::models::agent::AgentConfig>, String> {
    let cfg = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
    Ok(detect_agents(&cfg))
}

#[tauri::command]
pub async fn fetch_skillssh(sort: String, page: u32) -> Result<Vec<MarketplaceSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_skillssh_impl(&sort, page).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn fetch_clawhub(
    endpoint: String,
    params: HashMap<String, String>,
) -> Result<Vec<MarketplaceSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        fetch_clawhub_impl(&endpoint, &params).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

#[tauri::command]
pub async fn search_marketplace(query: String, source: String) -> Result<Vec<MarketplaceSkill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        match source.as_str() {
            "skills.sh" => search_skillssh(&query).map_err(|e| e.to_string()),
            "clawhub" => {
                crate::marketplace::clawhub::search_clawhub(&query).map_err(|e| e.to_string())
            }
            _ => Ok(Vec::new()),
        }
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

/// Install a marketplace skill, following the SkillDeck strategy:
/// 1. Clone the repo once
/// 2. Scan all SKILL.md files in the repo
/// 3. Match the target skill by name/directory
/// 4. Install to each target agent from the matched path
/// 5. Clean up the temp clone
#[tauri::command]
pub async fn install_from_marketplace(
    skill: MarketplaceSkill,
    target_agents: Vec<String>,
) -> Result<(), String> {
    // Offload the heavy git clone + file scan to a blocking thread
    // so the Tauri IPC channel stays responsive for UI updates
    tauri::async_runtime::spawn_blocking(move || {
        install_from_marketplace_sync(skill, target_agents)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn install_from_marketplace_sync(
    skill: MarketplaceSkill,
    target_agents: Vec<String>,
) -> Result<(), String> {
    let repo_url = skill
        .repository
        .ok_or_else(|| "marketplace item has no repository url".to_string())?;
    let agents = load_detected_agents()?;

    // 1. Clone the repo once to a temp directory
    let temp_dir = std::env::temp_dir().join(format!(
        "skills-app-marketplace-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis()
    ));
    {
        let mut proxy = git2::ProxyOptions::new();
        proxy.auto();
        let mut fetch = git2::FetchOptions::new();
        fetch.proxy_options(proxy);
        git2::build::RepoBuilder::new()
            .fetch_options(fetch)
            .clone(&repo_url, &temp_dir)
            .map_err(|e| format!("git clone failed: {e}"))?;
    }

    // 2. Scan the cloned repo for SKILL.md files and find the matching skill
    let skill_dir = find_skill_in_repo(&temp_dir, &skill.name);

    let result = match skill_dir {
        Some(dir) => {
            // 3. Install from the discovered path to all target agents
            install_skill_from_path(&dir, &target_agents, &agents)
                .map_err(|e| e.to_string())
        }
        None => {
            // Fallback: no matching skill found via scan, try repo root
            // This handles single-skill repos where the repo IS the skill
            install_skill_from_path(&temp_dir, &target_agents, &agents)
                .map_err(|e| e.to_string())
        }
    };

    // 4. Clean up temp directory
    let _ = std::fs::remove_dir_all(&temp_dir);

    // 5. Record provenance so the scanner can restore the source later
    if let Ok(ref canonical_dir) = result {
        let skill_id = canonical_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown");
        crate::installer::install::write_provenance(
            skill_id,
            &skill.source,
            Some(repo_url.as_str()),
            None,
        )
        .map_err(|e| e.to_string())?;
    }

    result.map(|_| ())
}

/// Walk the cloned repo directory, find all SKILL.md files, and match the target skill.
///
/// Matching strategy (in priority order):
/// 1. Directory name exactly matches skill name (e.g. `skills/find-skills/` for "find-skills")
/// 2. SKILL.md frontmatter `name` field matches skill name
/// 3. Directory name is a substring match (e.g. `skills/remotion/` for "remotion-best-practices")
fn find_skill_in_repo(repo_dir: &std::path::Path, skill_name: &str) -> Option<PathBuf> {
    let skill_name_lower = skill_name.to_lowercase();
    let candidates = discover_skill_dirs(repo_dir);

    // Match 1: exact directory name match
    if let Some(c) = candidates.iter().find(|c| {
        c.dir.file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.to_lowercase() == skill_name_lower)
            .unwrap_or(false)
    }) {
        return Some(c.dir.clone());
    }

    // Match 2: frontmatter `name` field matches
    if let Some(c) = candidates.iter().find(|c| {
        c.parsed_name
            .as_ref()
            .map(|n| n.to_lowercase() == skill_name_lower)
            .unwrap_or(false)
    }) {
        return Some(c.dir.clone());
    }

    // Match 3: directory name is contained in skill name
    //   e.g. dir "remotion" matches skill "remotion-best-practices"
    //   or skill name contains the dir name as a component
    if let Some(c) = candidates.iter().find(|c| {
        c.dir.file_name()
            .and_then(|n| n.to_str())
            .map(|n| {
                let n_lower = n.to_lowercase();
                skill_name_lower.starts_with(&format!("{n_lower}-"))
                    || skill_name_lower.starts_with(&format!("{n_lower}_"))
                    || skill_name_lower == n_lower
            })
            .unwrap_or(false)
    }) {
        return Some(c.dir.clone());
    }

    // Match 4: frontmatter name contains or is contained by skill name
    if let Some(c) = candidates.iter().find(|c| {
        c.parsed_name
            .as_ref()
            .map(|n| {
                let n_lower = n.to_lowercase();
                n_lower.contains(&skill_name_lower) || skill_name_lower.contains(&n_lower)
            })
            .unwrap_or(false)
    }) {
        return Some(c.dir.clone());
    }

    // Single skill in the repo — just use it if there's exactly one candidate
    if candidates.len() == 1 {
        return Some(candidates.into_iter().next().unwrap().dir);
    }

    None
}
