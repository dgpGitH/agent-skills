use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::installer::install::shared_skills_dir;
use crate::models::agent::AgentConfig;

#[derive(Debug, Error)]
pub enum UninstallError {
    #[error("agent `{0}` not found")]
    AgentNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Uninstall a skill from a single agent.
///
/// Strategy (aligned with vercel-labs/skills):
/// 1. Remove the symlink/copy from the agent's skills directory
/// 2. Check if any other agent still references the canonical copy
/// 3. Only remove canonical `~/.agents/skills/<name>/` if no references remain
/// 4. Clean up agent-specific registry entries
pub fn uninstall_skill(
    skill_id: &str,
    agent_slug: &str,
    agents: &[AgentConfig],
) -> Result<(), UninstallError> {
    let agent = agents
        .iter()
        .find(|a| a.slug == agent_slug)
        .ok_or_else(|| UninstallError::AgentNotFound(agent_slug.to_string()))?;

    // Step 1: Remove from agent's own directory (symlink or copied dir)
    if let Some(agent_root) = agent.global_paths.first() {
        let agent_skill = PathBuf::from(agent_root).join(skill_id);
        remove_entry(&agent_skill)?;
    }

    // Step 2: Check if canonical copy should be removed.
    // Only count direct installations (global_paths) as references — NOT
    // additional_readable_paths, because those are passive "I can read shared"
    // declarations, not active installations. Without this distinction the
    // canonical copy can never be removed when agents like Codex, Gemini CLI
    // declare ~/.agents/skills as a readable path.
    let canonical = shared_skills_dir().join(skill_id);
    if canonical.exists() {
        let still_referenced = agents.iter().any(|a| {
            if a.slug == agent_slug {
                return false; // skip the agent we just removed from
            }
            // Only check global_paths (direct installs / symlinks)
            a.global_paths.iter().any(|root| {
                PathBuf::from(root).join(skill_id).exists()
            })
        });

        if !still_referenced {
            remove_entry(&canonical)?;
            let _ = crate::installer::install::remove_provenance(skill_id);
        }
    }

    // Step 3: Clean up agent-specific registry entries
    if let Some(cfgs) = &agent.extra_config {
        for cfg in cfgs {
            if let Some(target_file) = &cfg.target_file {
                let path = expand_home_path(target_file);
                if path.is_file() {
                    // Try registry cleanup (remove skill entry from JSON array)
                    let _ = cleanup_registry_entry(&path, skill_id);
                }
            }
        }
    }

    Ok(())
}

/// Uninstall a skill from all agents at once.
///
/// Removes symlinks/copies from every agent directory, then removes canonical.
pub fn uninstall_skill_from_all(
    skill_id: &str,
    agents: &[AgentConfig],
) -> Result<(), UninstallError> {
    // Remove from every agent's directory
    for agent in agents {
        for root in &agent.global_paths {
            let agent_skill = PathBuf::from(root).join(skill_id);
            remove_entry(&agent_skill)?;
        }

        // Clean up extra config registries
        if let Some(cfgs) = &agent.extra_config {
            for cfg in cfgs {
                if let Some(target_file) = &cfg.target_file {
                    let path = expand_home_path(target_file);
                    if path.is_file() {
                        let _ = cleanup_registry_entry(&path, skill_id);
                    }
                }
            }
        }
    }

    // Remove canonical copy + provenance
    let canonical = shared_skills_dir().join(skill_id);
    remove_entry(&canonical)?;
    let _ = crate::installer::install::remove_provenance(skill_id);

    Ok(())
}

/// Remove a filesystem entry (symlink, directory, or file) if it exists.
/// Returns Ok(()) if the entry was removed or doesn't exist.
fn remove_entry(path: &Path) -> Result<(), std::io::Error> {
    let meta = match path.symlink_metadata() {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    let ft = meta.file_type();
    if ft.is_symlink() {
        // On Windows, directory symlinks must be removed with remove_dir, not remove_file.
        // path.is_dir() follows the symlink target — true for dir symlinks.
        #[cfg(windows)]
        if path.is_dir() {
            return fs::remove_dir(path);
        }
        fs::remove_file(path)
    } else if ft.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn cleanup_registry_entry(registry_path: &Path, skill_id: &str) -> Result<(), UninstallError> {
    if !registry_path.is_file() {
        return Ok(());
    }
    let content = fs::read_to_string(registry_path)?;
    let mut json: serde_json::Value = serde_json::from_str(&content)?;
    if let Some(skills) = json.get_mut("skills").and_then(|v| v.as_array_mut()) {
        let before = skills.len();
        skills.retain(|item| {
            item.get("path")
                .and_then(|v| v.as_str())
                .map(|path| {
                    !path.ends_with(&format!("/{skill_id}"))
                        && !path.ends_with(&format!("\\{skill_id}"))
                })
                .unwrap_or(true)
        });
        if skills.len() != before {
            fs::write(registry_path, serde_json::to_string_pretty(&json)?)?;
        }
    }
    Ok(())
}

fn expand_home_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            let normalized = stripped.replace('/', std::path::MAIN_SEPARATOR_STR);
            return home.join(normalized);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skills-app-uninstall-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock drift")
                .as_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn uninstall_removes_symlink_and_canonical_when_no_refs() {
        let agent_root = test_dir("agent");
        let canonical_root = shared_skills_dir();
        let skill_name = format!("test-uninstall-{}", std::process::id());

        // Create canonical
        let canonical_skill = canonical_root.join(&skill_name);
        fs::create_dir_all(&canonical_skill).expect("create canonical");
        fs::write(canonical_skill.join("SKILL.md"), "test").expect("write");

        // Create symlink in agent dir
        let agent_link = agent_root.join(&skill_name);
        #[cfg(unix)]
        std::os::unix::fs::symlink(&canonical_skill, &agent_link).expect("symlink");
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir(&canonical_skill, &agent_link).expect("symlink");

        let agent = AgentConfig {
            slug: "test-agent".into(),
            name: "Test".into(),
            global_paths: vec![agent_root.to_string_lossy().to_string()],
            ..Default::default()
        };

        uninstall_skill(&skill_name, "test-agent", &[agent]).expect("uninstall");

        // Both symlink and canonical should be gone
        assert!(!agent_link.exists());
        assert!(!canonical_skill.exists());
    }

    #[test]
    fn uninstall_keeps_canonical_when_other_agent_refs() {
        let agent1_root = test_dir("agent1");
        let agent2_root = test_dir("agent2");
        let canonical_root = shared_skills_dir();
        let skill_name = format!("test-keep-{}", std::process::id());

        // Create canonical
        let canonical_skill = canonical_root.join(&skill_name);
        fs::create_dir_all(&canonical_skill).expect("create canonical");
        fs::write(canonical_skill.join("SKILL.md"), "test").expect("write");

        // Create symlink in both agent dirs
        let link1 = agent1_root.join(&skill_name);
        let link2 = agent2_root.join(&skill_name);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&canonical_skill, &link1).expect("symlink1");
            std::os::unix::fs::symlink(&canonical_skill, &link2).expect("symlink2");
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(&canonical_skill, &link1).expect("symlink1");
            std::os::windows::fs::symlink_dir(&canonical_skill, &link2).expect("symlink2");
        }

        let agents = vec![
            AgentConfig {
                slug: "agent-a".into(),
                name: "Agent A".into(),
                global_paths: vec![agent1_root.to_string_lossy().to_string()],
                ..Default::default()
            },
            AgentConfig {
                slug: "agent-b".into(),
                name: "Agent B".into(),
                global_paths: vec![agent2_root.to_string_lossy().to_string()],
                ..Default::default()
            },
        ];

        // Uninstall from agent-a only
        uninstall_skill(&skill_name, "agent-a", &agents).expect("uninstall");

        // agent-a symlink gone, but canonical and agent-b remain
        assert!(!link1.exists());
        assert!(link2.exists());
        assert!(canonical_skill.exists());

        // Cleanup
        let _ = fs::remove_dir_all(&canonical_skill);
        let _ = fs::remove_file(&link2);
    }

    #[test]
    fn uninstall_from_all_removes_everything() {
        let agent1_root = test_dir("all-agent1");
        let agent2_root = test_dir("all-agent2");
        let canonical_root = shared_skills_dir();
        let skill_name = format!("test-all-{}", std::process::id());

        let canonical_skill = canonical_root.join(&skill_name);
        fs::create_dir_all(&canonical_skill).expect("create canonical");
        fs::write(canonical_skill.join("SKILL.md"), "test").expect("write");

        let link1 = agent1_root.join(&skill_name);
        let link2 = agent2_root.join(&skill_name);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&canonical_skill, &link1).expect("symlink1");
            std::os::unix::fs::symlink(&canonical_skill, &link2).expect("symlink2");
        }
        #[cfg(windows)]
        {
            std::os::windows::fs::symlink_dir(&canonical_skill, &link1).expect("symlink1");
            std::os::windows::fs::symlink_dir(&canonical_skill, &link2).expect("symlink2");
        }

        let agents = vec![
            AgentConfig {
                slug: "agent-a".into(),
                name: "Agent A".into(),
                global_paths: vec![agent1_root.to_string_lossy().to_string()],
                ..Default::default()
            },
            AgentConfig {
                slug: "agent-b".into(),
                name: "Agent B".into(),
                global_paths: vec![agent2_root.to_string_lossy().to_string()],
                ..Default::default()
            },
        ];

        uninstall_skill_from_all(&skill_name, &agents).expect("uninstall all");

        assert!(!link1.exists());
        assert!(!link2.exists());
        assert!(!canonical_skill.exists());
    }

    #[test]
    fn cleanup_registry_entry_by_skill_id() {
        let root = test_dir("registry");
        let reg = root.join("manifest.json");
        fs::write(
            &reg,
            r#"{"skills":[{"path":"/home/.cursor/skills/keep-me"},{"path":"/home/.cursor/skills/remove-me"}]}"#,
        )
        .expect("write registry");
        cleanup_registry_entry(&reg, "remove-me").expect("cleanup");
        let content = fs::read_to_string(reg).expect("read registry");
        assert!(content.contains("keep-me"));
        assert!(!content.contains("remove-me"));
    }
}
