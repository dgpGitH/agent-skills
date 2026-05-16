use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use chrono::Utc;
use git2::{build::RepoBuilder, FetchOptions, ProxyOptions, Repository};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::commands::settings::{read_settings, write_settings, RepoEntry};
use crate::installer::install::install_skill_from_path;
use crate::models::agent::AgentConfig;
use crate::models::repo::SkillRepo;
use crate::models::skill::{Skill, SkillScope, SkillSource};
use crate::parser::skillmd::parse_skill_md_file;
use crate::paths;
use crate::registry::loader::{detect_agents, load_agent_configs};
use crate::scanner::engine::discover_skill_dirs;

/// Progress event payload emitted during git clone / sync operations.
#[derive(Clone, Serialize)]
pub struct RepoProgress {
    pub stage: String,
    pub detail: Option<String>,
}

/// Combined result for add_skill_repo / add_local_dir so the frontend gets
/// both the repo metadata and the full skill list in a single IPC round-trip.
#[derive(Clone, Serialize)]
pub struct AddRepoResult {
    pub repo: SkillRepo,
    pub skills: Vec<Skill>,
}

/// Directory where repos are cloned
fn repos_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".skills-app")
        .join("repos")
}

/// Generate a stable ID from a repo URL — uses the repo name for readability
fn repo_id(url: &str) -> String {
    repo_name_from_url(url)
}

/// Generate a stable ID from a local directory path
fn local_dir_id(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("local-{:016x}", hasher.finish())
}

/// Manifest file in a skill repo (optional)
#[derive(Debug, Deserialize, Default)]
struct SkillsManifest {
    name: Option<String>,
    description: Option<String>,
    skills_dir: Option<String>,
}

/// Parse skills.toml from a repo root, if present
fn parse_manifest(repo_path: &Path) -> SkillsManifest {
    let manifest_path = repo_path.join("skills.toml");
    if manifest_path.is_file() {
        if let Ok(content) = fs::read_to_string(&manifest_path) {
            if let Ok(manifest) = toml::from_str::<SkillsManifest>(&content) {
                return manifest;
            }
        }
    }
    SkillsManifest::default()
}

/// Get the skills directory within a repo clone
fn skills_root(repo_path: &Path, manifest: &SkillsManifest) -> PathBuf {
    if let Some(ref dir) = manifest.skills_dir {
        let candidate = repo_path.join(dir);
        if candidate.is_dir() {
            return candidate;
        }
    }
    // Default: try "skills/" subdir first, then repo root
    let default_dir = repo_path.join("skills");
    if default_dir.is_dir() {
        return default_dir;
    }
    repo_path.to_path_buf()
}

/// Count skill directories (directories containing SKILL.md)
fn count_skills(skills_path: &Path) -> usize {
    let Ok(entries) = fs::read_dir(skills_path) else {
        return 0;
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let ft = e.file_type().ok();
            ft.is_some_and(|t| t.is_dir()) && e.path().join("SKILL.md").is_file()
        })
        .count()
}

/// Build a SkillRepo from local clone state
fn build_skill_repo(repo_url: &str, local_path: &Path, id: &str) -> SkillRepo {
    let manifest = parse_manifest(local_path);
    let sr = skills_root(local_path, &manifest);
    let name = manifest
        .name
        .unwrap_or_else(|| repo_name_from_url(repo_url));
    SkillRepo {
        id: id.to_string(),
        name,
        description: manifest.description,
        repo_url: repo_url.to_string(),
        local_path: local_path.to_string_lossy().to_string(),
        last_synced: None, // caller fills this in
        skill_count: count_skills(&sr),
    }
}

fn repo_name_from_url(url: &str) -> String {
    url.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git")
        .to_string()
}

fn load_detected_agents() -> Result<Vec<AgentConfig>, String> {
    let configs = load_agent_configs(&paths::agents_dir()).map_err(|e| e.to_string())?;
    Ok(detect_agents(&configs))
}

/// Look up the git repo URL for a repo ID from settings. Returns None for local dirs.
fn resolve_repo_url(repo_id_param: &str) -> Option<String> {
    if repo_id_param.starts_with("local-") {
        return None;
    }
    let settings = read_settings().unwrap_or_default();
    settings
        .repos
        .unwrap_or_default()
        .iter()
        .find(|r| r.repo_url.as_deref().map(repo_id).as_deref() == Some(repo_id_param))
        .and_then(|e| e.repo_url.clone())
}

/// Resolve the local filesystem path for a repo given its ID.
/// For local dirs (id starts with "local-"), looks up the path from settings.
/// For git repos, returns the clone directory under repos_dir().
fn resolve_repo_path(repo_id_param: &str) -> Result<PathBuf, String> {
    if repo_id_param.starts_with("local-") {
        let settings = read_settings().unwrap_or_default();
        let repos = settings.repos.unwrap_or_default();
        repos
            .iter()
            .find(|r| r.local_path.as_ref().map(|lp| local_dir_id(lp)) == Some(repo_id_param.to_string()))
            .and_then(|e| e.local_path.clone())
            .map(PathBuf::from)
            .ok_or_else(|| "Local directory not found in config".to_string())
    } else {
        Ok(repos_dir().join(repo_id_param))
    }
}

// ─── Tauri Commands ───

#[tauri::command]
pub async fn add_skill_repo(app: AppHandle, repo_url: String) -> Result<AddRepoResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        add_skill_repo_sync(&app, repo_url)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn emit_progress(app: &AppHandle, stage: &str, detail: Option<&str>) {
    let _ = app.emit("repo-progress", RepoProgress {
        stage: stage.to_string(),
        detail: detail.map(|s| s.to_string()),
    });
}

/// Build FetchOptions with automatic proxy detection (git config, env vars, system proxy).
fn proxy_fetch_options<'a>() -> FetchOptions<'a> {
    let mut proxy = ProxyOptions::new();
    proxy.auto();
    let mut opts = FetchOptions::new();
    opts.proxy_options(proxy);
    opts
}

fn add_skill_repo_sync(app: &AppHandle, repo_url: String) -> Result<AddRepoResult, String> {
    let id = repo_id(&repo_url);
    let local_path = repos_dir().join(&id);

    // If already cloned and registered, reuse the existing repo instead of re-cloning.
    // This handles the case where a user uninstalls all skills from a repo and later
    // wants to re-install from the same source.
    if local_path.exists() {
        let settings = read_settings().unwrap_or_default();
        let in_config = settings.repos.as_ref().is_some_and(|repos| {
            repos.iter().any(|r| r.repo_url.as_deref() == Some(&repo_url))
        });
        if in_config {
            emit_progress(app, "scanning", None);
            let mut repo = build_skill_repo(&repo_url, &local_path, &id);
            let skills = list_repo_skills_sync(id.clone()).unwrap_or_default();
            repo.skill_count = skills.len();
            repo.last_synced = settings.repos.as_ref()
                .and_then(|repos| repos.iter().find(|r| r.repo_url.as_deref() == Some(&repo_url)))
                .and_then(|e| e.last_synced.clone());
            emit_progress(app, "done", None);
            return Ok(AddRepoResult { repo, skills });
        }
        // Stale directory from a previous interrupted clone — clean up
        let _ = fs::remove_dir_all(&local_path);
    }

    // Ensure parent directory exists; git2::clone will create the target dir
    if let Some(parent) = local_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    emit_progress(app, "cloning", Some(&repo_url));

    // Clone the repository (with proxy auto-detection)
    RepoBuilder::new()
        .fetch_options(proxy_fetch_options())
        .clone(&repo_url, &local_path)
        .map_err(|e| {
            // Clean up on failure
            let _ = fs::remove_dir_all(&local_path);
            format!("Failed to clone repository: {}", e)
        })?;

    emit_progress(app, "scanning", None);

    let now = Utc::now().to_rfc3339();
    let mut repo = build_skill_repo(&repo_url, &local_path, &id);
    repo.last_synced = Some(now.clone());

    // Scan skills while we're at it — avoids a second IPC round-trip
    let skills = list_repo_skills_sync(id.clone()).unwrap_or_default();
    repo.skill_count = skills.len();

    emit_progress(app, "saving", None);

    // Save to config
    let mut settings = read_settings().unwrap_or_default();
    let repos = settings.repos.get_or_insert_with(Vec::new);
    repos.push(RepoEntry {
        repo_url: Some(repo_url.clone()),
        local_path: None,
        last_synced: Some(now),
    });
    write_settings(settings).map_err(|e| e.to_string())?;

    emit_progress(app, "done", None);

    Ok(AddRepoResult { repo, skills })
}

#[tauri::command]
pub fn remove_skill_repo(repo_id_param: String) -> Result<(), String> {
    // Only delete the clone directory for git repos (local dirs are not managed by us)
    if !repo_id_param.starts_with("local-") {
        let local_path = repos_dir().join(&repo_id_param);
        if local_path.exists() {
            fs::remove_dir_all(&local_path).map_err(|e| e.to_string())?;
        }
    }

    // Remove from config
    let mut settings = read_settings().unwrap_or_default();
    if let Some(ref mut repos) = settings.repos {
        repos.retain(|r| {
            if let Some(ref lp) = r.local_path {
                local_dir_id(lp) != repo_id_param
            } else if let Some(ref url) = r.repo_url {
                repo_id(url) != repo_id_param
            } else {
                true
            }
        });
    }
    write_settings(settings).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn list_skill_repos() -> Result<Vec<SkillRepo>, String> {
    let settings = read_settings().unwrap_or_default();
    let repo_entries = settings.repos.unwrap_or_default();

    let mut result = Vec::new();
    for entry in &repo_entries {
        if let Some(ref lp) = entry.local_path {
            let dir = Path::new(lp);
            if !dir.exists() {
                continue;
            }
            let id = local_dir_id(lp);
            let manifest = parse_manifest(dir);
            let sr = skills_root(dir, &manifest);
            let name = manifest.name.unwrap_or_else(|| {
                dir.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Local".to_string())
            });
            result.push(SkillRepo {
                id,
                name,
                description: manifest.description,
                repo_url: lp.clone(),
                local_path: lp.clone(),
                last_synced: None,
                skill_count: count_skills(&sr),
            });
        } else if let Some(ref url) = entry.repo_url {
            let id = repo_id(url);
            let local_path = repos_dir().join(&id);
            if !local_path.exists() {
                continue;
            }
            let mut repo = build_skill_repo(url, &local_path, &id);
            repo.last_synced = entry.last_synced.clone();
            result.push(repo);
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn sync_skill_repo(app: AppHandle, repo_id_param: String) -> Result<SkillRepo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sync_skill_repo_sync(&app, repo_id_param)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn sync_skill_repo_sync(app: &AppHandle, repo_id_param: String) -> Result<SkillRepo, String> {
    let local_path = repos_dir().join(&repo_id_param);
    if !local_path.exists() {
        return Err("Repository not found locally".to_string());
    }

    emit_progress(app, "fetching", None);

    // Open and pull
    let repo = Repository::open(&local_path).map_err(|e| e.to_string())?;

    // Fetch origin (with proxy auto-detection)
    let mut remote = repo.find_remote("origin").map_err(|e| e.to_string())?;
    remote
        .fetch(&["HEAD"], Some(&mut proxy_fetch_options()), None)
        .map_err(|e| e.to_string())?;

    emit_progress(app, "merging", None);

    // Fast-forward merge
    let fetch_head = repo
        .find_reference("FETCH_HEAD")
        .map_err(|e| e.to_string())?;
    let fetch_commit = repo
        .reference_to_annotated_commit(&fetch_head)
        .map_err(|e| e.to_string())?;
    let head = repo.head().map_err(|e| e.to_string())?;
    let head_name = head.name().unwrap_or("HEAD").to_string();

    let (analysis, _) = repo
        .merge_analysis(&[&fetch_commit])
        .map_err(|e| e.to_string())?;

    if analysis.is_fast_forward() || analysis.is_normal() {
        let target_oid = fetch_commit.id();
        let target_commit = repo
            .find_object(target_oid, None)
            .map_err(|e| e.to_string())?;
        repo.checkout_tree(&target_commit, None)
            .map_err(|e| e.to_string())?;
        repo.reference(&head_name, target_oid, true, "skills-app sync")
            .map_err(|e| e.to_string())?;
    }
    // If up-to-date, nothing to do

    emit_progress(app, "saving", None);

    let now = Utc::now().to_rfc3339();

    // Read settings once: extract repo_url and update last_synced in the same pass
    let mut settings = read_settings().unwrap_or_default();
    let mut repo_url = String::new();
    if let Some(ref mut repos) = settings.repos {
        for entry in repos.iter_mut() {
            if entry.repo_url.as_deref().map(repo_id).as_deref() == Some(&repo_id_param) {
                entry.last_synced = Some(now.clone());
                if let Some(ref url) = entry.repo_url {
                    repo_url = url.clone();
                }
            }
        }
    }
    write_settings(settings).map_err(|e| e.to_string())?;

    let mut skill_repo = build_skill_repo(&repo_url, &local_path, &repo_id_param);
    skill_repo.last_synced = Some(now);

    emit_progress(app, "done", None);

    Ok(skill_repo)
}

#[tauri::command]
pub async fn list_repo_skills(repo_id_param: String) -> Result<Vec<Skill>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_repo_skills_sync(repo_id_param)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn list_repo_skills_sync(repo_id_param: String) -> Result<Vec<Skill>, String> {
    let local_path = resolve_repo_path(&repo_id_param)?;
    if !local_path.exists() {
        return Err("Repository not found locally".to_string());
    }

    let repo_url = resolve_repo_url(&repo_id_param);
    let candidates = discover_skill_dirs(&local_path);

    let mut skills: Vec<Skill> = Vec::new();
    for candidate in candidates {
        // Parse full SKILL.md for description and metadata
        let skill_md = candidate.dir.join("SKILL.md");
        let parsed = match parse_skill_md_file(&skill_md) {
            Ok(p) => p,
            Err(_) => continue,
        };
        // A valid skill must have a description
        if parsed.description.is_none() {
            continue;
        }

        let dir_name = candidate.dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown-skill")
            .to_string();
        let skill_name = candidate.parsed_name.unwrap_or_else(|| dir_name.clone());

        let source = if let Some(ref url) = repo_url {
            SkillSource::GitRepository {
                repo_url: url.clone(),
                skill_path: Some(dir_name.clone()),
            }
        } else {
            SkillSource::LocalPath {
                path: local_path.to_string_lossy().to_string(),
            }
        };

        skills.push(Skill {
            id: dir_name,
            name: skill_name,
            description: parsed.description,
            canonical_path: candidate.dir.to_string_lossy().to_string(),
            source: Some(source),
            metadata: parsed.metadata,
            collection: None,
            scope: SkillScope::default(),
            installations: Vec::new(),
        });
    }

    skills.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(skills)
}

#[tauri::command]
pub async fn install_repo_skill(
    repo_id_param: String,
    skill_id: String,
    target_agents: Vec<String>,
) -> Result<(), String> {
    if target_agents.iter().any(|a| a == "shared") {
        return Err("Cannot install directly to the shared skills directory. Install to a specific agent instead.".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        install_repo_skill_sync(repo_id_param, skill_id, target_agents)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn install_repo_skill_sync(
    repo_id_param: String,
    skill_id: String,
    target_agents: Vec<String>,
) -> Result<(), String> {
    let local_path = resolve_repo_path(&repo_id_param)?;
    if !local_path.exists() {
        return Err("Repository not found locally".to_string());
    }

    // Find the skill by matching directory name against all discovered skill dirs.
    // This handles repos where skills are nested arbitrarily deep (e.g. .claude/skills/<name>/).
    let candidates = discover_skill_dirs(&local_path);
    let skill_path = candidates
        .iter()
        .find(|c| {
            c.dir
                .file_name()
                .and_then(|f| f.to_str())
                .map(|n| n == skill_id)
                .unwrap_or(false)
        })
        .map(|c| c.dir.clone())
        .ok_or_else(|| format!("Skill '{}' not found in repository", skill_id))?;

    let agents = load_detected_agents()?;
    let canonical = install_skill_from_path(&skill_path, &target_agents, &agents)
        .map_err(|e| e.to_string())?;

    // Record provenance so update_skill can find the upstream source later
    let installed_id = canonical
        .file_name()
        .and_then(|f| f.to_str())
        .unwrap_or(&skill_id);
    let repo_url = resolve_repo_url(&repo_id_param);
    let source_label = if repo_url.is_some() { "git" } else { "local" };
    crate::installer::install::write_provenance(
        installed_id,
        source_label,
        repo_url.as_deref(),
        Some(&skill_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn add_local_dir(path: String) -> Result<AddRepoResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        add_local_dir_sync(path)
    })
    .await
    .map_err(|e| format!("task failed: {e}"))?
}

fn add_local_dir_sync(path: String) -> Result<AddRepoResult, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Read settings once: check for duplicates, then append and write back
    let mut settings = read_settings().unwrap_or_default();
    if let Some(ref repos) = settings.repos {
        if repos.iter().any(|r| r.local_path.as_deref() == Some(&path)) {
            return Err("This directory is already added".to_string());
        }
    }

    let id = local_dir_id(&path);
    let manifest = parse_manifest(dir);
    let name = manifest.name.unwrap_or_else(|| {
        dir.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Local".to_string())
    });

    let repos = settings.repos.get_or_insert_with(Vec::new);
    repos.push(RepoEntry {
        repo_url: None,
        local_path: Some(path.clone()),
        last_synced: None,
    });
    write_settings(settings).map_err(|e| e.to_string())?;

    // Scan skills up front — avoids a second IPC round-trip
    // (must happen after settings write so resolve_repo_path can find the local dir)
    let skills = list_repo_skills_sync(id.clone()).unwrap_or_default();

    let repo = SkillRepo {
        id: id.clone(),
        name,
        description: manifest.description,
        repo_url: path.clone(),
        local_path: path,
        last_synced: None,
        skill_count: skills.len(),
    };

    Ok(AddRepoResult { repo, skills })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "skills-app-repos-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock drift")
                .as_millis()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    // ─── Unit tests for utility functions ───

    #[test]
    fn repo_name_from_url_https() {
        assert_eq!(
            repo_name_from_url("https://github.com/org/my-skills.git"),
            "my-skills"
        );
    }

    #[test]
    fn repo_name_from_url_trailing_slash() {
        assert_eq!(
            repo_name_from_url("https://github.com/org/my-skills/"),
            "my-skills"
        );
    }

    #[test]
    fn repo_name_from_url_no_git_suffix() {
        assert_eq!(
            repo_name_from_url("https://github.com/org/skills"),
            "skills"
        );
    }

    #[test]
    fn repo_name_from_url_ssh() {
        assert_eq!(
            repo_name_from_url("git@github.com:org/awesome-skills.git"),
            "awesome-skills"
        );
    }

    #[test]
    fn repo_id_matches_repo_name() {
        let url = "https://github.com/org/my-skills.git";
        assert_eq!(repo_id(url), "my-skills");
    }

    #[test]
    fn local_dir_id_is_stable() {
        let path = "/Users/test/my-skills";
        let id1 = local_dir_id(path);
        let id2 = local_dir_id(path);
        assert_eq!(id1, id2);
        assert!(id1.starts_with("local-"));
        assert_eq!(id1.len(), 6 + 16); // "local-" + 16 hex chars
    }

    #[test]
    fn local_dir_id_differs_for_different_paths() {
        let id1 = local_dir_id("/a/b/c");
        let id2 = local_dir_id("/a/b/d");
        assert_ne!(id1, id2);
    }

    // ─── Manifest parsing tests ───

    #[test]
    fn parse_manifest_missing_file() {
        let dir = test_dir("manifest-missing");
        let m = parse_manifest(&dir);
        assert!(m.name.is_none());
        assert!(m.description.is_none());
        assert!(m.skills_dir.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_manifest_with_all_fields() {
        let dir = test_dir("manifest-full");
        fs::write(
            dir.join("skills.toml"),
            r#"
name = "My Skills"
description = "A collection"
skills_dir = "custom"
"#,
        )
        .unwrap();
        let m = parse_manifest(&dir);
        assert_eq!(m.name.as_deref(), Some("My Skills"));
        assert_eq!(m.description.as_deref(), Some("A collection"));
        assert_eq!(m.skills_dir.as_deref(), Some("custom"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn parse_manifest_invalid_toml_returns_default() {
        let dir = test_dir("manifest-invalid");
        fs::write(dir.join("skills.toml"), "not valid { toml").unwrap();
        let m = parse_manifest(&dir);
        assert!(m.name.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    // ─── skills_root tests ───

    #[test]
    fn skills_root_uses_manifest_dir() {
        let dir = test_dir("sr-manifest");
        let custom = dir.join("custom");
        fs::create_dir(&custom).unwrap();
        let manifest = SkillsManifest {
            skills_dir: Some("custom".to_string()),
            ..Default::default()
        };
        assert_eq!(skills_root(&dir, &manifest), custom);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skills_root_falls_back_to_skills_subdir() {
        let dir = test_dir("sr-skills");
        let skills = dir.join("skills");
        fs::create_dir(&skills).unwrap();
        let manifest = SkillsManifest::default();
        assert_eq!(skills_root(&dir, &manifest), skills);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skills_root_falls_back_to_repo_root() {
        let dir = test_dir("sr-root");
        let manifest = SkillsManifest::default();
        assert_eq!(skills_root(&dir, &manifest), dir);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn skills_root_manifest_dir_missing_falls_back() {
        let dir = test_dir("sr-missing");
        let manifest = SkillsManifest {
            skills_dir: Some("custom".to_string()),
            ..Default::default()
        };
        // No "skills/" either, so falls back to repo root
        assert_eq!(skills_root(&dir, &manifest), dir);
        let _ = fs::remove_dir_all(&dir);
    }

    // ─── count_skills tests ───

    #[test]
    fn count_skills_empty_dir() {
        let dir = test_dir("count-empty");
        assert_eq!(count_skills(&dir), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn count_skills_counts_correctly() {
        let dir = test_dir("count-correct");

        // Valid skill dirs (contain SKILL.md)
        for name in &["skill-a", "skill-b"] {
            let d = dir.join(name);
            fs::create_dir(&d).unwrap();
            fs::write(d.join("SKILL.md"), "---\nname: test\n---").unwrap();
        }

        // Non-skill dir (no SKILL.md)
        fs::create_dir(dir.join("not-a-skill")).unwrap();

        // File, not a directory
        fs::write(dir.join("README.md"), "hello").unwrap();

        assert_eq!(count_skills(&dir), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn count_skills_nonexistent_path() {
        assert_eq!(count_skills(Path::new("/nonexistent/path")), 0);
    }

    // ─── build_skill_repo tests ───

    #[test]
    fn build_skill_repo_basic() {
        let dir = test_dir("build-basic");
        let skills = dir.join("skills");
        fs::create_dir(&skills).unwrap();
        let d = skills.join("my-skill");
        fs::create_dir(&d).unwrap();
        fs::write(d.join("SKILL.md"), "---\nname: test\n---").unwrap();

        let repo = build_skill_repo(
            "https://github.com/org/my-repo.git",
            &dir,
            "my-repo",
        );
        assert_eq!(repo.id, "my-repo");
        assert_eq!(repo.name, "my-repo");
        assert_eq!(repo.skill_count, 1);
        assert!(repo.last_synced.is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_skill_repo_uses_manifest_name() {
        let dir = test_dir("build-manifest");
        fs::write(
            dir.join("skills.toml"),
            "name = \"Custom Name\"\n",
        )
        .unwrap();
        let repo = build_skill_repo("https://example.com/repo.git", &dir, "repo");
        assert_eq!(repo.name, "Custom Name");
        let _ = fs::remove_dir_all(&dir);
    }

    /// Integration test: simulates the repo structure of
    /// https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
    /// where skills are nested under .claude/skills/<name>/SKILL.md
    #[test]
    fn list_repo_skills_finds_deeply_nested_claude_skills() {
        let dir = test_dir("deep-claude-skills");

        // Simulate the repo structure: .claude/skills/<name>/SKILL.md
        let skills_base = dir.join(".claude").join("skills");
        let skill_names = [
            ("ui-ux-pro-max", "UI/UX Pro Max"),
            ("design", "ckm:design"),
            ("brand", "ckm:brand"),
        ];
        for (dir_name, frontmatter_name) in &skill_names {
            let skill_dir = skills_base.join(dir_name);
            fs::create_dir_all(&skill_dir).unwrap();
            fs::write(
                skill_dir.join("SKILL.md"),
                format!(
                    "---\nname: {frontmatter_name}\ndescription: test {dir_name}\n---\nBody"
                ),
            )
            .unwrap();
        }

        // Add noise: files and dirs without SKILL.md
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("README.md"), "hello").unwrap();
        fs::write(dir.join("skill.json"), "{}").unwrap();

        // Use discover_skill_dirs directly (same path as list_repo_skills_sync)
        let candidates = discover_skill_dirs(&dir);
        assert_eq!(
            candidates.len(),
            3,
            "should find 3 skills nested under .claude/skills/"
        );

        let found_names: std::collections::HashSet<String> = candidates
            .iter()
            .map(|c| {
                c.dir
                    .file_name()
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert!(found_names.contains("ui-ux-pro-max"));
        assert!(found_names.contains("design"));
        assert!(found_names.contains("brand"));

        let _ = fs::remove_dir_all(&dir);
    }
}
