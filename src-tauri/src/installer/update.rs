use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::build::RepoBuilder;
use git2::{FetchOptions, ProxyOptions, Repository};
use thiserror::Error;

use crate::installer::install::{install_skill_from_path, read_provenance, write_provenance};
use crate::models::agent::AgentConfig;
use crate::models::skill::{UpdateAllResult, UpdateProgress};
use crate::scanner::engine::{discover_skill_dirs, scan_all_skills, SkillCandidate};

#[derive(Debug, Error)]
pub enum UpdateError {
    #[error("no provenance for skill '{0}'")]
    NoProvenance(String),
    #[error("no repository URL for skill '{0}'")]
    NoRepository(String),
    #[error("skill '{0}' not found in repository")]
    SkillNotFound(String),
    #[error("git error: {0}")]
    Git(#[from] git2::Error),
    #[error("install error: {0}")]
    Install(#[from] crate::installer::install::InstallError),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// RepoSession — manages git lifecycle for a single repository
// ---------------------------------------------------------------------------

/// Holds a local checkout of a repository for skill extraction.
/// Automatically cleans up temporary clones on drop.
pub struct RepoSession {
    path: PathBuf,
    is_temp: bool,
    candidates: Vec<SkillCandidate>,
}

impl RepoSession {
    /// Open or create a local checkout for the given repo URL.
    ///
    /// If a persistent clone exists under `~/.skills-app/repos/`, git-pull it.
    /// Otherwise, create a temporary clone that is cleaned up on drop.
    pub fn open(repo_url: &str) -> Result<Self, UpdateError> {
        let persistent_clone = persistent_clone_path(repo_url);

        let (path, is_temp) = if persistent_clone.exists() {
            git_pull(&persistent_clone)?;
            (persistent_clone, false)
        } else {
            let temp = std::env::temp_dir().join(format!(
                "skills-app-update-{}",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .expect("clock drift")
                    .as_millis()
            ));
            let mut proxy = ProxyOptions::new();
            proxy.auto();
            let mut fetch = FetchOptions::new();
            fetch.proxy_options(proxy);
            RepoBuilder::new()
                .fetch_options(fetch)
                .clone(repo_url, &temp)?;
            (temp, true)
        };

        let candidates = discover_skill_dirs(&path);
        Ok(Self { path, is_temp, candidates })
    }

    /// Find a skill directory by id (directory name), falling back to frontmatter name
    /// and then to the provenance `skill_path` hint.
    pub fn find_skill(&self, skill_id: &str, skill_path_hint: Option<&str>) -> Option<&Path> {
        // 1. Exact directory name match
        if let Some(c) = self.candidates.iter().find(|c| dir_name(&c.dir) == skill_id) {
            return Some(&c.dir);
        }
        // 2. Frontmatter name match
        if let Some(c) = self.candidates.iter().find(|c| {
            c.parsed_name.as_deref() == Some(skill_id)
        }) {
            return Some(&c.dir);
        }
        // 3. Provenance skill_path hint (directory basename)
        if let Some(hint) = skill_path_hint {
            if let Some(c) = self.candidates.iter().find(|c| dir_name(&c.dir) == hint) {
                return Some(&c.dir);
            }
        }
        None
    }

    #[allow(dead_code)]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for RepoSession {
    fn drop(&mut self) {
        if self.is_temp {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn dir_name(path: &Path) -> &str {
    path.file_name().and_then(|f| f.to_str()).unwrap_or("")
}

/// Derive the persistent clone path: `~/.skills-app/repos/<repo-basename>`
fn persistent_clone_path(repo_url: &str) -> PathBuf {
    let name = repo_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("repo")
        .trim_end_matches(".git");
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".skills-app")
        .join("repos")
        .join(name)
}

/// Fetch + fast-forward an existing repository clone.
fn git_pull(local_path: &Path) -> Result<(), git2::Error> {
    let repo = Repository::open(local_path)?;
    let mut proxy = ProxyOptions::new();
    proxy.auto();
    let mut fetch_opts = FetchOptions::new();
    fetch_opts.proxy_options(proxy);
    let mut remote = repo.find_remote("origin")?;
    remote.fetch(&["HEAD"], Some(&mut fetch_opts), None)?;

    let fetch_head = repo.find_reference("FETCH_HEAD")?;
    let fc = repo.reference_to_annotated_commit(&fetch_head)?;
    let (analysis, _) = repo.merge_analysis(&[&fc])?;

    if analysis.is_fast_forward() || analysis.is_normal() {
        let target = repo.find_object(fc.id(), None)?;
        repo.checkout_tree(&target, None)?;
        let head = repo.head()?;
        let head_name = head.name().unwrap_or("HEAD").to_string();
        repo.reference(&head_name, fc.id(), true, "skill update")?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Single-skill update
// ---------------------------------------------------------------------------

/// Update a single skill from an already-opened RepoSession.
pub fn update_skill(
    skill_id: &str,
    source_label: &str,
    repo_url: &str,
    skill_path_hint: Option<&str>,
    target_agents: &[String],
    agents: &[AgentConfig],
    session: &RepoSession,
) -> Result<(), UpdateError> {
    let skill_dir = session
        .find_skill(skill_id, skill_path_hint)
        .ok_or_else(|| UpdateError::SkillNotFound(skill_id.to_string()))?;

    install_skill_from_path(skill_dir, target_agents, agents)?;

    write_provenance(skill_id, source_label, Some(repo_url), skill_path_hint)
        .map_err(UpdateError::Io)?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Batch update
// ---------------------------------------------------------------------------

/// Update all skills that have a repository URL in provenance.
///
/// Groups skills by repo to minimize git operations, emits progress via callback.
pub fn update_all(
    agents: &[AgentConfig],
    on_progress: impl Fn(UpdateProgress),
) -> UpdateAllResult {
    let provenance = read_provenance();
    let all_skills = scan_all_skills(agents).unwrap_or_default();

    // Collect updatable skills: must have a repo URL in provenance
    let mut updatable: Vec<UpdatableSkill> = Vec::new();
    for (skill_id, entry) in &provenance {
        let repo = entry.get("repository").and_then(|v| v.as_str()).unwrap_or("");
        if repo.is_empty() {
            continue;
        }
        let source = entry.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let skill_path = entry.get("skill_path").and_then(|v| v.as_str());

        // Determine target agents for this skill
        let target_agents: Vec<String> = all_skills
            .iter()
            .find(|s| s.id == *skill_id)
            .map(|s| s.all_agents())
            .unwrap_or_default();

        updatable.push(UpdatableSkill {
            id: skill_id.clone(),
            repo_url: repo.to_string(),
            source_label: source.to_string(),
            skill_path_hint: skill_path.map(String::from),
            target_agents,
        });
    }

    let total = updatable.len();
    let skipped = provenance.len() - total;

    // Group by repository URL
    let mut groups: HashMap<String, Vec<UpdatableSkill>> = HashMap::new();
    for skill in updatable {
        groups
            .entry(skill.repo_url.clone())
            .or_default()
            .push(skill);
    }

    let mut result = UpdateAllResult {
        skipped,
        ..Default::default()
    };
    let mut done = 0;

    for (repo_url, skills) in &groups {
        // Open session once per repo
        let session = match RepoSession::open(repo_url) {
            Ok(s) => s,
            Err(e) => {
                // All skills in this repo fail
                for skill in skills {
                    done += 1;
                    on_progress(UpdateProgress {
                        done,
                        total,
                        current_skill: skill.id.clone(),
                    });
                    result.failed.push((skill.id.clone(), e.to_string()));
                }
                continue;
            }
        };

        for skill in skills {
            done += 1;
            on_progress(UpdateProgress {
                done,
                total,
                current_skill: skill.id.clone(),
            });

            match update_skill(
                &skill.id,
                &skill.source_label,
                &skill.repo_url,
                skill.skill_path_hint.as_deref(),
                &skill.target_agents,
                agents,
                &session,
            ) {
                Ok(_) => result.updated.push(skill.id.clone()),
                Err(e) => result.failed.push((skill.id.clone(), e.to_string())),
            }
        }
        // session drops here → temp clone cleaned up
    }

    result
}

struct UpdatableSkill {
    id: String,
    repo_url: String,
    source_label: String,
    skill_path_hint: Option<String>,
    target_agents: Vec<String>,
}
