use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use git2::{build::RepoBuilder, FetchOptions, ProxyOptions};
use handlebars::Handlebars;
use serde_json::json;
use thiserror::Error;

use crate::models::agent::AgentConfig;

#[derive(Debug, Error)]
pub enum InstallError {
    #[error("source skill directory not found: {0}")]
    SourceNotFound(String),
    #[error("agent `{0}` has no global paths configured")]
    MissingTargetPath(String),
    #[error("agent `{0}` is unsupported")]
    AgentNotFound(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("template rendering error: {0}")]
    Template(#[from] handlebars::RenderError),
    #[error("template compile error: {0}")]
    TemplateCompile(#[from] handlebars::TemplateError),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
}

/// Install a skill from a local path to one or more target agents.
///
/// Canonical model:
/// 1. Copy skill files to `~/.agents/skills/<name>/` (canonical location)
/// 2. For each target agent, create a symlink from agent's skills dir → canonical
/// 3. If agent reads `~/.agents/skills/` via additional_readable_paths, skip symlink
/// 4. Apply agent-specific hooks (Gemini extension, extra config)
pub fn install_skill_from_path(
    source_skill_dir: &Path,
    target_agent_slugs: &[String],
    agents: &[AgentConfig],
) -> Result<PathBuf, InstallError> {
    install_skill_from_path_with_name(source_skill_dir, target_agent_slugs, agents, None)
}

fn install_skill_from_path_with_name(
    source_skill_dir: &Path,
    target_agent_slugs: &[String],
    agents: &[AgentConfig],
    target_skill_name: Option<&str>,
) -> Result<PathBuf, InstallError> {
    if !source_skill_dir.is_dir() {
        return Err(InstallError::SourceNotFound(
            source_skill_dir.to_string_lossy().to_string(),
        ));
    }

    let fallback = source_skill_dir
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("skill");
    let skill_name = target_skill_name
        .map(sanitize_skill_dir_name)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| sanitize_skill_dir_name(fallback));

    // Step 1: Install to canonical location ~/.agents/skills/<name>/
    let canonical_dir = install_to_canonical(source_skill_dir, &skill_name)?;

    // Step 2: For each target agent, create symlink or apply hooks
    for slug in target_agent_slugs {
        let agent = agents
            .iter()
            .find(|a| a.slug == *slug)
            .ok_or_else(|| InstallError::AgentNotFound(slug.to_string()))?;

        // Check if agent reads ~/.agents/skills/ via additional_readable_paths
        let reads_shared = agent.additional_readable_paths.iter().any(|rp| {
            let rp_path = PathBuf::from(&rp.path);
            rp_path == shared_skills_dir()
        });

        if reads_shared {
            // Agent reads shared dir directly — no symlink needed
        } else {
            // Agent needs a symlink from its own dir → canonical
            let agent_root = agent
                .global_paths
                .first()
                .map(PathBuf::from)
                .ok_or_else(|| InstallError::MissingTargetPath(slug.to_string()))?;
            fs::create_dir_all(&agent_root)?;
            let agent_skill_link = agent_root.join(&skill_name);

            // Remove existing entry (symlink, dir, or file)
            if agent_skill_link.symlink_metadata().is_ok() {
                if agent_skill_link.is_dir() && !is_symlink(&agent_skill_link) {
                    fs::remove_dir_all(&agent_skill_link)?;
                } else {
                    // symlink or file
                    fs::remove_file(&agent_skill_link)?;
                }
            }

            link_or_copy(&canonical_dir, &agent_skill_link)?;
        }

        if let Some(extra_cfgs) = &agent.extra_config {
            for cfg in extra_cfgs {
                if let (Some(template), Some(target_file)) = (&cfg.template, &cfg.target_file) {
                    render_extra_config(template, target_file, slug, &skill_name)?;
                }
            }
        }
    }

    Ok(canonical_dir)
}

/// Copy skill files to the canonical location `~/.agents/skills/<name>/`.
/// If source is already the canonical location, skip the copy.
fn install_to_canonical(
    source_skill_dir: &Path,
    skill_name: &str,
) -> Result<PathBuf, InstallError> {
    let target_root = shared_skills_dir();
    fs::create_dir_all(&target_root)?;
    let target_skill_dir = target_root.join(skill_name);

    // Skip copy if source is already the canonical location
    let source_canonical = fs::canonicalize(source_skill_dir).unwrap_or(source_skill_dir.to_path_buf());
    let target_canonical = fs::canonicalize(&target_skill_dir).unwrap_or(target_skill_dir.clone());
    if source_canonical == target_canonical {
        return Ok(target_skill_dir);
    }

    if target_skill_dir.exists() {
        fs::remove_dir_all(&target_skill_dir)?;
    }
    copy_dir_recursive(source_skill_dir, &target_skill_dir)?;
    Ok(target_skill_dir)
}

/// Link an agent's skill directory to the canonical location.
/// Tries symlink first; falls back to copy if symlink fails
/// (e.g. Windows without developer mode / elevated privileges).
fn link_or_copy(original: &Path, link: &Path) -> Result<(), InstallError> {
    let symlink_result = create_symlink(original, link);
    if symlink_result.is_ok() {
        return Ok(());
    }
    // Fallback: copy the directory instead
    eprintln!(
        "symlink failed, falling back to copy: {} -> {}",
        original.display(),
        link.display()
    );
    copy_dir_recursive(original, link)?;
    Ok(())
}

fn create_symlink(original: &Path, link: &Path) -> Result<(), InstallError> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(original, link)?;
    }
    #[cfg(windows)]
    {
        std::os::windows::fs::symlink_dir(original, link)?;
    }
    Ok(())
}

fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

pub fn install_skill_from_git(
    repo_url: &str,
    skill_relative_path: &str,
    target_agent_slugs: &[String],
    agents: &[AgentConfig],
) -> Result<PathBuf, InstallError> {
    install_skill_from_git_with_source(repo_url, skill_relative_path, target_agent_slugs, agents, "git")
}

pub fn install_skill_from_git_with_source(
    repo_url: &str,
    skill_relative_path: &str,
    target_agent_slugs: &[String],
    agents: &[AgentConfig],
    source_label: &str,
) -> Result<PathBuf, InstallError> {
    let temp_dir = std::env::temp_dir().join(format!(
        "skills-app-install-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis()
    ));
    {
        let mut proxy = ProxyOptions::new();
        proxy.auto();
        let mut fetch = FetchOptions::new();
        fetch.proxy_options(proxy);
        RepoBuilder::new()
            .fetch_options(fetch)
            .clone(repo_url, &temp_dir)?;
    }
    let source = temp_dir.join(skill_relative_path);
    let skill_name = derive_git_target_skill_name(repo_url, skill_relative_path, &source);
    let installed =
        install_skill_from_path_with_name(&source, target_agent_slugs, agents, Some(&skill_name))?;
    let _ = fs::remove_dir_all(temp_dir);

    // Record provenance
    let skill_id = installed
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or("unknown");
    let rel = skill_relative_path.trim();
    let skill_path = if rel.is_empty() || rel == "." { None } else { Some(rel) };
    write_provenance(skill_id, source_label, Some(repo_url), skill_path)
        .map_err(InstallError::Io)?;

    Ok(installed)
}

fn derive_git_target_skill_name(repo_url: &str, skill_relative_path: &str, source: &Path) -> String {
    let rel = skill_relative_path.trim();
    if !rel.is_empty() && rel != "." {
        let from_rel = Path::new(rel)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or(rel);
        return sanitize_skill_dir_name(from_rel);
    }
    let from_repo = repo_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("skill")
        .trim_end_matches(".git");
    let from_repo = sanitize_skill_dir_name(from_repo);
    if !from_repo.is_empty() {
        return from_repo;
    }
    source
        .file_name()
        .and_then(|s| s.to_str())
        .map(sanitize_skill_dir_name)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "skill".to_string())
}

fn sanitize_skill_dir_name(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' => '-',
            _ => ch,
        })
        .collect::<String>()
}

fn render_extra_config(
    template_file: &str,
    target_file: &str,
    agent_slug: &str,
    skill_name: &str,
) -> Result<(), InstallError> {
    let template_path = crate::paths::templates_dir().join(template_file);
    let template_content = fs::read_to_string(template_path)?;
    let mut hbs = Handlebars::new();
    hbs.register_template_string("extra", template_content)?;
    let rendered = hbs.render(
        "extra",
        &json!({
            "agent_slug": agent_slug,
            "skill_name": skill_name,
        }),
    )?;
    let target_path = expand_home_path(target_file);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(target_path, rendered)?;
    Ok(())
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = target.join(entry.file_name());
        let ft = entry.metadata()?.file_type();
        if ft.is_symlink() {
            // Skip symlinks — don't dereference to avoid copying large external trees
            continue;
        } else if ft.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Provenance registry — central `.provenance.json` in the shared skills dir
// ---------------------------------------------------------------------------

fn provenance_path() -> PathBuf {
    shared_skills_dir().join(".provenance.json")
}

/// Read the provenance registry. Returns empty map if the file is missing or corrupt.
pub fn read_provenance() -> HashMap<String, serde_json::Value> {
    let path = provenance_path();
    if !path.is_file() {
        return HashMap::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// Record where a skill was installed from.
pub fn write_provenance(
    skill_id: &str,
    source: &str,
    repository: Option<&str>,
    skill_path: Option<&str>,
) -> Result<(), std::io::Error> {
    let mut map = read_provenance();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    map.insert(
        skill_id.to_string(),
        json!({
            "source": source,
            "repository": repository,
            "skill_path": skill_path,
            "installed_at": now,
        }),
    );
    let content = serde_json::to_string_pretty(&map).unwrap_or_default();
    fs::write(provenance_path(), content)
}

/// Remove a provenance entry (e.g. on uninstall).
pub fn remove_provenance(skill_id: &str) -> Result<(), std::io::Error> {
    let mut map = read_provenance();
    if map.remove(skill_id).is_some() {
        let content = serde_json::to_string_pretty(&map).unwrap_or_default();
        fs::write(provenance_path(), content)?;
    }
    Ok(())
}

// The cross-agent shared skills directory per the Agent Skills specification.
const SHARED_SKILLS_PATH: &str = "~/.agents/skills";

pub fn shared_skills_dir() -> PathBuf {
    expand_home_path(SHARED_SKILLS_PATH)
}

fn expand_home_path(path: &str) -> PathBuf {
    if let Some(stripped) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(stripped);
        }
    }
    PathBuf::from(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::agent::{AgentConfig, ReadablePath};

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skills-app-installer-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock drift")
                .as_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn install_copies_to_canonical_and_creates_symlink() {
        let src = test_dir("src");
        let src_skill = src.join("demo");
        fs::create_dir_all(src_skill.join("scripts")).expect("create scripts");
        fs::write(src_skill.join("SKILL.md"), "# demo").expect("write skill");
        fs::write(src_skill.join("scripts/run.sh"), "echo hi").expect("write script");

        let agent_dir = test_dir("agent-out");
        let agent = AgentConfig {
            slug: "claude-code".into(),
            name: "Claude Code".into(),
            global_paths: vec![agent_dir.to_string_lossy().to_string()],
            ..Default::default()
        };
        let slugs = vec!["claude-code".to_string()];
        let canonical = install_skill_from_path(&src_skill, &slugs, &[agent]).expect("install");

        // Canonical dir should have the files
        assert!(canonical.join("SKILL.md").is_file());
        assert!(canonical.join("scripts/run.sh").is_file());

        // Agent dir should have a symlink
        let agent_link = agent_dir.join("demo");
        assert!(agent_link.exists());
        assert!(is_symlink(&agent_link));
    }

    #[test]
    fn install_skips_symlink_when_agent_reads_shared() {
        let src = test_dir("src-shared");
        let src_skill = src.join("shared-skill");
        fs::create_dir_all(&src_skill).expect("create skill dir");
        fs::write(src_skill.join("SKILL.md"), "# shared").expect("write skill");

        let shared_dir = shared_skills_dir();
        let agent = AgentConfig {
            slug: "codex".into(),
            name: "Codex".into(),
            global_paths: vec![test_dir("codex-skills").to_string_lossy().to_string()],
            additional_readable_paths: vec![ReadablePath {
                path: shared_dir.to_string_lossy().to_string(),
                source_agent: "shared".to_string(),
            }],
            ..Default::default()
        };
        let slugs = vec!["codex".to_string()];
        let canonical = install_skill_from_path(&src_skill, &slugs, &[agent.clone()])
            .expect("install");

        // Canonical dir should have the files
        assert!(canonical.join("SKILL.md").is_file());

        // Agent dir should NOT have a symlink (agent reads shared directly)
        let agent_root = PathBuf::from(&agent.global_paths[0]);
        let agent_link = agent_root.join("shared-skill");
        assert!(!agent_link.exists());
    }


    #[test]
    fn git_install_name_uses_repo_basename_for_root() {
        let source = std::path::Path::new("/tmp/skills-app-install-12345");
        let name =
            derive_git_target_skill_name("https://github.com/org/awesome-skill.git", ".", source);
        assert_eq!(name, "awesome-skill");
    }

    #[test]
    fn git_install_name_uses_relative_path_basename() {
        let source = std::path::Path::new("/tmp/skills-app-install-12345/skills/my-tool");
        let name = derive_git_target_skill_name(
            "https://github.com/org/mono-repo.git",
            "skills/my-tool",
            source,
        );
        assert_eq!(name, "my-tool");
    }
}
