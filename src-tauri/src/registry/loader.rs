use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::models::agent::AgentConfig;

#[derive(Debug, Error)]
pub enum RegistryError {
    #[error("failed to read agent config directory: {0}")]
    ReadDir(#[from] std::io::Error),
    #[error("failed to parse TOML `{path}`: {source}")]
    ParseToml { path: String, source: toml::de::Error },
}

pub fn load_agent_configs(dir: &Path) -> Result<Vec<AgentConfig>, RegistryError> {
    let mut configs = Vec::new();
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        let content = fs::read_to_string(&path)?;
        let mut config: AgentConfig =
            toml::from_str(&content).map_err(|source| RegistryError::ParseToml {
                path: path.to_string_lossy().to_string(),
                source,
            })?;
        config.global_paths = config
            .global_paths
            .into_iter()
            .map(|p| expand_home(&p))
            .collect();
        for rp in &mut config.additional_readable_paths {
            rp.path = expand_home(&rp.path);
        }
        configs.push(config);
    }
    configs.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(configs)
}

pub fn detect_agents(configs: &[AgentConfig]) -> Vec<AgentConfig> {
    configs.iter().map(detect_agent).collect()
}

fn detect_agent(config: &AgentConfig) -> AgentConfig {
    // 1. Check CLI command first (most reliable)
    let mut detected = config
        .cli_command
        .as_ref()
        .is_some_and(|cmd| command_exists(cmd));

    // 2. Check if agent config directory exists (parent of skills path)
    //    e.g. ~/.claude/skills → check ~/.claude/
    //    e.g. ~/.codeium/windsurf/skills → check ~/.codeium/windsurf/
    if !detected {
        detected = config
            .global_paths
            .iter()
            .map(PathBuf::from)
            .any(|p| {
                p.exists()
                    || p.file_name()
                        .is_some_and(|name| name == "skills" && p.parent().is_some_and(|parent| parent.exists()))
            });
    }

    let mut cloned = config.clone();
    cloned.detected = detected;
    cloned
}

fn command_exists(command: &str) -> bool {
    which::which(command).is_ok()
}

pub fn expand_home(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            // Normalize separators: on Windows, .join preserves forward slashes from the TOML input
            let normalized = stripped.replace('/', std::path::MAIN_SEPARATOR_STR);
            return home.join(normalized).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> PathBuf {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis();
        let dir = std::env::temp_dir().join(format!("skills-app-registry-{name}-{millis}"));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn parse_toml_configs() {
        let dir = test_dir("parse");
        let config = r#"
slug = "codex"
name = "Codex"
enabled = true
global_paths = ["~/.codex/skills"]
skill_format = "skill-md"
cli_command = "codex"
"#;
        fs::write(dir.join("codex.toml"), config).expect("write config");

        let loaded = load_agent_configs(&dir).expect("load configs");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].slug, "codex");
        assert!(loaded[0].global_paths[0].starts_with('/'));
    }

    #[test]
    fn parse_toml_with_readable_paths() {
        let dir = test_dir("readable");
        let config = r#"
slug = "opencode"
name = "OpenCode"
enabled = true
global_paths = ["~/.opencode/skills"]
skill_format = "skill-md"
cli_command = "opencode"

[[additional_readable_paths]]
path = "~/.claude/skills"
source_agent = "claude-code"

[[additional_readable_paths]]
path = "~/.agents/skills"
source_agent = "shared"
"#;
        fs::write(dir.join("opencode.toml"), config).expect("write config");

        let loaded = load_agent_configs(&dir).expect("load configs");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].additional_readable_paths.len(), 2);
        assert!(loaded[0].additional_readable_paths[0].path.starts_with('/'));
        assert_eq!(
            loaded[0].additional_readable_paths[0].source_agent,
            "claude-code"
        );
        assert_eq!(
            loaded[0].additional_readable_paths[1].source_agent,
            "shared"
        );
    }

    #[test]
    fn detect_from_existing_path() {
        let dir = test_dir("detect-path");
        let skill_dir = dir.join("skills");
        fs::create_dir_all(&skill_dir).expect("create skill dir");
        let config = AgentConfig {
            slug: "local".into(),
            name: "Local".into(),
            enabled: true,
            global_paths: vec![skill_dir.to_string_lossy().to_string()],
            ..Default::default()
        };
        let detected = detect_agents(&[config]);
        assert!(detected[0].detected);
    }
}
