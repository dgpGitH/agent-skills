use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::installer::install::{read_provenance, shared_skills_dir};
use crate::models::agent::AgentConfig;
use crate::models::skill::{Skill, SkillInstallation, SkillScope, SkillSource};
use crate::parser::skillmd::parse_skill_md_file;

/// A directory containing a SKILL.md, discovered by recursive scanning.
#[derive(Debug, Clone)]
pub struct SkillCandidate {
    /// The directory containing SKILL.md
    pub dir: PathBuf,
    /// The `name` field from SKILL.md frontmatter, if present
    pub parsed_name: Option<String>,
}

/// Recursively walk `root` and collect all directories that contain a SKILL.md file.
/// Also checks `root` itself. Skips `.git` directories.
pub fn discover_skill_dirs(root: &Path) -> Vec<SkillCandidate> {
    let mut candidates = Vec::new();

    fn walk(dir: &Path, candidates: &mut Vec<SkillCandidate>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name();
            if name == ".git" {
                continue;
            }
            if path.is_dir() {
                let skill_md = path.join("SKILL.md");
                if skill_md.is_file() {
                    let parsed_name = parse_skill_md_file(&skill_md)
                        .ok()
                        .and_then(|p| p.name);
                    candidates.push(SkillCandidate {
                        dir: path.clone(),
                        parsed_name,
                    });
                }
                walk(&path, candidates);
            }
        }
    }

    walk(root, &mut candidates);

    // Also check root itself
    let root_skill_md = root.join("SKILL.md");
    if root_skill_md.is_file() {
        let parsed_name = parse_skill_md_file(&root_skill_md)
            .ok()
            .and_then(|p| p.name);
        candidates.push(SkillCandidate {
            dir: root.to_path_buf(),
            parsed_name,
        });
    }

    candidates
}

#[derive(Debug, Error)]
pub enum ScannerError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

/// Resolve a path through symlink chains to its final real path.
/// Equivalent to Swift's `resolvingSymlinksInPath()`.
fn resolve_canonical(path: &Path) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Check if a path is a symlink (without following it).
fn is_symlink(path: &Path) -> bool {
    path.symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

/// Scan all skills across all agents, returning deduplicated results.
///
/// Strategy:
/// 1. Scan each agent's own skill directories (global_paths)
/// 2. Scan each agent's additional_readable_paths as inherited installations
/// 3. Always scan ~/.agents/skills/ (canonical shared directory) as a virtual "shared" agent
/// 4. Resolve symlinks to get canonical path
/// 5. Merge by directory name (dedup key) — same name = same skill
/// 6. Track per-agent installations with symlink/inherited metadata
/// 7. Upgrade scope to SharedGlobal if installed in >1 agent
pub fn scan_all_skills(configs: &[AgentConfig]) -> Result<Vec<Skill>, ScannerError> {
    let mut dedup: HashMap<String, Skill> = HashMap::new();
    let provenance = read_provenance();

    // Pass 1: Scan each agent's own directories (direct installations)
    for agent in configs.iter().filter(|cfg| cfg.detected || !cfg.global_paths.is_empty()) {
        for root in &agent.global_paths {
            let root_path = PathBuf::from(root);
            if !root_path.exists() {
                continue;
            }
            scan_skill_md_root(&root_path, agent, &mut dedup, &provenance)?;
        }
    }

    // Pass 2: Scan additional readable paths (inherited installations)
    for agent in configs.iter().filter(|cfg| cfg.detected) {
        for readable in &agent.additional_readable_paths {
            let root_path = PathBuf::from(&readable.path);
            if !root_path.exists() {
                continue;
            }
            scan_inherited_root(
                &root_path,
                agent,
                &readable.source_agent,
                &mut dedup,
                &provenance,
            )?;
        }
    }

    // Pass 3: Always scan the canonical shared skills directory (~/.agents/skills/)
    // This ensures skills are discoverable and manageable even when no AI coding agent
    // is installed or detected on the system. Skills found here are associated with a
    // virtual "shared" agent that is always present.
    {
        let shared_dir = shared_skills_dir();
        if shared_dir.exists() || fs::create_dir_all(&shared_dir).is_ok() {
            let shared_agent = AgentConfig {
                slug: "shared".to_string(),
                name: "Shared Skills".to_string(),
                enabled: true,
                detected: true,
                global_paths: vec![shared_dir.to_string_lossy().to_string()],
                ..Default::default()
            };
            // Only scan if the directory has entries (avoid empty scan noise)
            if shared_dir.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
                scan_skill_md_root(&shared_dir, &shared_agent, &mut dedup, &provenance)?;
            }
        }
    }

    let mut items: Vec<Skill> = dedup.into_values().collect();
    items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(items)
}

/// Scan a readable directory for inherited skills (read-only, from another agent or shared).
fn scan_inherited_root(
    root: &Path,
    agent: &AgentConfig,
    source_agent: &str,
    dedup: &mut HashMap<String, Skill>,
    provenance: &HashMap<String, serde_json::Value>,
) -> Result<(), ScannerError> {
    for dir in fs::read_dir(root)?.flatten() {
        let skill_dir = dir.path();
        if !skill_dir.is_dir() && !is_symlink(&skill_dir) {
            continue;
        }
        let canonical = resolve_canonical(&skill_dir);
        let skill_md = canonical.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }
        let parsed = match parse_skill_md_file(&skill_md) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skipping {}: {e}", skill_md.display());
                continue;
            }
        };

        // A valid skill must have a description in frontmatter
        if parsed.description.is_none() {
            continue;
        }

        let dir_name = skill_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown-skill")
            .to_string();
        let collection = detect_collection(&skill_dir, root);
        let skill_name = parsed.name.clone().unwrap_or_else(|| dir_name.clone());

        let installation = SkillInstallation {
            agent_slug: agent.slug.clone(),
            path: skill_dir.to_string_lossy().to_string(),
            is_symlink: is_symlink(&skill_dir),
            is_inherited: true,
            inherited_from: Some(source_agent.to_string()),
        };

        merge_skill(
            dedup,
            dir_name.clone(),
            Skill {
                id: dir_name.clone(),
                name: skill_name,
                description: parsed.description,
                canonical_path: canonical.to_string_lossy().to_string(),
                source: Some(resolve_source(&dir_name, &canonical, provenance)),
                metadata: parsed.metadata,
                collection,
                scope: SkillScope::SharedGlobal,
                installations: vec![installation],
            },
        );
    }
    Ok(())
}

fn scan_skill_md_root(
    root: &Path,
    agent: &AgentConfig,
    dedup: &mut HashMap<String, Skill>,
    provenance: &HashMap<String, serde_json::Value>,
) -> Result<(), ScannerError> {
    for dir in fs::read_dir(root)? {
        let dir = dir?;
        let skill_dir = dir.path();
        if !skill_dir.is_dir() && !is_symlink(&skill_dir) {
            continue;
        }

        // Resolve symlinks to canonical path
        let canonical = resolve_canonical(&skill_dir);
        let skill_md = canonical.join("SKILL.md");
        if !skill_md.is_file() {
            continue;
        }

        let parsed = match parse_skill_md_file(&skill_md) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("skipping {}: {e}", skill_md.display());
                continue;
            }
        };

        // A valid skill must have a description in frontmatter
        if parsed.description.is_none() {
            continue;
        }

        // Dedup key = directory name
        let dir_name = skill_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown-skill")
            .to_string();

        let raw_name = parsed.name.clone().unwrap_or_else(|| dir_name.clone());
        let symlink = is_symlink(&skill_dir);

        let collection = detect_collection(&skill_dir, root);

        let skill_name = raw_name;

        let installation = SkillInstallation {
            agent_slug: agent.slug.clone(),
            path: skill_dir.to_string_lossy().to_string(),
            is_symlink: symlink,
            is_inherited: false,
            inherited_from: None,
        };

        let skill_id = skill_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown-skill")
            .to_string();

        merge_skill(
            dedup,
            dir_name,
            Skill {
                id: skill_id.clone(),
                name: skill_name,
                description: parsed.description,
                canonical_path: canonical.to_string_lossy().to_string(),
                source: Some(resolve_source(&skill_id, &canonical, provenance)),
                metadata: parsed.metadata,
                collection,
                scope: SkillScope::AgentLocal {
                    agent: agent.slug.clone(),
                },
                installations: vec![installation],
            },
        );
    }
    Ok(())
}

/// Detect if a skill belongs to a collection.
///
/// Checks two cases:
/// 1. The skill directory itself is a symlink into a collection dir
/// 2. The SKILL.md inside is a symlink into a collection dir
///
/// Example: `browse/SKILL.md` → `gstack/browse/SKILL.md` → collection = "gstack"
fn detect_collection(skill_dir: &Path, skills_root: &Path) -> Option<String> {
    // Case 1: directory is a symlink
    if is_symlink(skill_dir) {
        if let Some(c) = collection_from_real_path(skill_dir, skills_root) {
            return Some(c);
        }
    }
    // Case 2: SKILL.md inside is a symlink
    let skill_md = skill_dir.join("SKILL.md");
    if is_symlink(&skill_md) {
        // Resolve SKILL.md's real path, then take its parent dir
        let real_md = fs::canonicalize(&skill_md).ok()?;
        let real_dir = real_md.parent()?;
        return collection_from_real_path(real_dir, skills_root);
    }
    None
}

fn collection_from_real_path(real_or_link: &Path, skills_root: &Path) -> Option<String> {
    let real = fs::canonicalize(real_or_link).ok()?;
    let root_canon = fs::canonicalize(skills_root).ok()?;
    let relative = real.strip_prefix(&root_canon).ok()?;
    let components: Vec<_> = relative.components().collect();
    if components.len() >= 2 {
        components[0].as_os_str().to_str().map(String::from)
    } else {
        None
    }
}

/// Resolve the source of a skill from the provenance registry, falling back to LocalPath.
fn resolve_source(
    skill_id: &str,
    canonical: &Path,
    provenance: &HashMap<String, serde_json::Value>,
) -> SkillSource {
    if let Some(entry) = provenance.get(skill_id) {
        let src = entry.get("source").and_then(|v| v.as_str()).unwrap_or("");
        let repo = entry
            .get("repository")
            .and_then(|v| v.as_str())
            .map(String::from);
        let skill_path = entry
            .get("skill_path")
            .and_then(|v| v.as_str())
            .map(String::from);
        match src {
            "skills.sh" => return SkillSource::SkillsSh { repository: repo },
            "clawhub" => return SkillSource::ClawHub { repository: repo },
            "git" => {
                return SkillSource::GitRepository {
                    repo_url: repo.unwrap_or_default(),
                    skill_path,
                }
            }
            _ => {}
        }
    }
    SkillSource::LocalPath {
        path: canonical.to_string_lossy().to_string(),
    }
}

/// Merge an incoming skill into the dedup map.
///
/// If a skill with the same key already exists:
/// - Append new installations (skip duplicates by agent_slug)
/// - Upgrade scope to SharedGlobal if now installed in >1 agent
fn merge_skill(dedup: &mut HashMap<String, Skill>, key: String, incoming: Skill) {
    if let Some(existing) = dedup.get_mut(&key) {
        // Preserve collection from whichever side has it
        if existing.collection.is_none() && incoming.collection.is_some() {
            existing.collection = incoming.collection;
        }
        for inst in incoming.installations {
            let dominated = existing
                .installations
                .iter()
                .any(|e| e.agent_slug == inst.agent_slug);
            if !dominated {
                existing.installations.push(inst);
            }
        }
        // Scope upgrade: if >1 distinct non-inherited agent, upgrade to SharedGlobal
        let distinct_agents: std::collections::HashSet<&str> = existing
            .installations
            .iter()
            .filter(|i| !i.is_inherited)
            .map(|i| i.agent_slug.as_str())
            .collect();
        if distinct_agents.len() > 1 {
            existing.scope = SkillScope::SharedGlobal;
        }
        return;
    }
    dedup.insert(key, incoming);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::agent::{AgentConfig, ReadablePath};

    fn test_dir(name: &str) -> PathBuf {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock drift")
            .as_millis();
        let dir = std::env::temp_dir().join(format!("skills-app-scanner-{name}-{millis}"));
        fs::create_dir_all(&dir).expect("create temp test dir");
        dir
    }

    #[test]
    fn dedup_same_skill_in_multiple_agents() {
        let root = test_dir("dedup");
        let shared_skill_dir = root.join("skill-a");
        fs::create_dir_all(&shared_skill_dir).expect("create skill dir");
        fs::write(
            shared_skill_dir.join("SKILL.md"),
            "---\nname: Skill A\ndescription: test\n---\nBody",
        )
        .expect("write skill");

        let cfg1 = AgentConfig {
            slug: "codex".to_string(),
            name: "Codex".to_string(),
            global_paths: vec![root.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };
        let cfg2 = AgentConfig {
            slug: "cursor".to_string(),
            name: "Cursor".to_string(),
            global_paths: vec![root.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };

        let skills = scan_all_skills(&[cfg1, cfg2]).expect("scan");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].installations.len(), 2);
        assert_eq!(skills[0].scope, SkillScope::SharedGlobal);
    }

    #[test]
    fn symlink_resolved_and_merged() {
        let root1 = test_dir("sym-agent1");
        let root2 = test_dir("sym-agent2");
        let canonical_dir = test_dir("sym-canonical");

        let skill_canon = canonical_dir.join("my-skill");
        fs::create_dir_all(&skill_canon).expect("create canonical skill");
        fs::write(
            skill_canon.join("SKILL.md"),
            "---\nname: My Skill\ndescription: test skill\n---\nBody",
        )
        .expect("write skill");

        let link1 = root1.join("my-skill");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&skill_canon, &link1).expect("create symlink");

        let link2 = root2.join("my-skill");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&skill_canon, &link2).expect("create symlink");

        let cfg1 = AgentConfig {
            slug: "agent-a".to_string(),
            name: "Agent A".to_string(),
            global_paths: vec![root1.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };
        let cfg2 = AgentConfig {
            slug: "agent-b".to_string(),
            name: "Agent B".to_string(),
            global_paths: vec![root2.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };

        let skills = scan_all_skills(&[cfg1, cfg2]).expect("scan");
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].installations.len(), 2);
        assert!(skills[0].installations.iter().all(|i| i.is_symlink));
        assert_eq!(skills[0].scope, SkillScope::SharedGlobal);
    }

    #[test]
    fn scan_additional_readable_paths() {
        let shared = test_dir("readable-shared");
        let claude_dir = test_dir("readable-claude");

        // Skill in shared dir
        let shared_skill = shared.join("my-shared-skill");
        fs::create_dir_all(&shared_skill).expect("create shared skill dir");
        fs::write(
            shared_skill.join("SKILL.md"),
            "---\nname: Shared Skill\ndescription: from shared\n---\nBody",
        )
        .expect("write skill");

        // Skill in claude dir
        let claude_skill = claude_dir.join("claude-only");
        fs::create_dir_all(&claude_skill).expect("create claude skill dir");
        fs::write(
            claude_skill.join("SKILL.md"),
            "---\nname: Claude Only\ndescription: claude only skill\n---\nBody",
        )
        .expect("write skill");

        // Codex reads ~/.agents/skills (shared)
        let cfg_codex = AgentConfig {
            slug: "codex".to_string(),
            name: "Codex".to_string(),
            global_paths: vec![],
            detected: true,
            additional_readable_paths: vec![ReadablePath {
                path: shared.to_string_lossy().to_string(),
                source_agent: "shared".to_string(),
            }],
            ..Default::default()
        };
        // Cursor reads ~/.claude/skills
        let cfg_cursor = AgentConfig {
            slug: "cursor".to_string(),
            name: "Cursor".to_string(),
            global_paths: vec![],
            detected: true,
            additional_readable_paths: vec![ReadablePath {
                path: claude_dir.to_string_lossy().to_string(),
                source_agent: "claude-code".to_string(),
            }],
            ..Default::default()
        };
        // Claude Code has no additional readable paths
        let cfg_claude = AgentConfig {
            slug: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            global_paths: vec![claude_dir.to_string_lossy().to_string()],
            detected: true,
            ..Default::default()
        };

        let skills = scan_all_skills(&[cfg_codex, cfg_cursor, cfg_claude]).expect("scan");
        assert_eq!(skills.len(), 2);

        let shared_skill = skills.iter().find(|s| s.id == "my-shared-skill").unwrap();
        assert_eq!(shared_skill.installations.len(), 1);
        assert_eq!(shared_skill.installations[0].agent_slug, "codex");
        assert!(shared_skill.installations[0].is_inherited);
        assert_eq!(
            shared_skill.installations[0].inherited_from.as_deref(),
            Some("shared")
        );

        let claude_skill = skills.iter().find(|s| s.id == "claude-only").unwrap();
        // Claude (direct) + Cursor (inherited)
        assert_eq!(claude_skill.installations.len(), 2);
        let direct = claude_skill
            .installations
            .iter()
            .find(|i| i.agent_slug == "claude-code")
            .unwrap();
        assert!(!direct.is_inherited);
        let inherited = claude_skill
            .installations
            .iter()
            .find(|i| i.agent_slug == "cursor")
            .unwrap();
        assert!(inherited.is_inherited);
        assert_eq!(inherited.inherited_from.as_deref(), Some("claude-code"));
    }

    #[test]
    fn discover_skill_dirs_finds_deeply_nested_skills() {
        // Simulates a repo like nextlevelbuilder/ui-ux-pro-max-skill
        // where skills live under .claude/skills/<name>/SKILL.md
        let root = test_dir("discover-deep");

        // Create nested skill dirs like .claude/skills/foo/SKILL.md
        let nested_dir = root.join(".claude").join("skills");
        for name in &["ui-ux-pro-max", "design", "brand"] {
            let skill_dir = nested_dir.join(name);
            fs::create_dir_all(&skill_dir).expect("create skill dir");
            fs::write(
                skill_dir.join("SKILL.md"),
                format!("---\nname: {name}\ndescription: test {name}\n---\nBody"),
            )
            .expect("write skill");
        }

        // Also create a top-level dir without SKILL.md (noise)
        fs::create_dir_all(root.join("src")).expect("create src");
        fs::write(root.join("README.md"), "hello").expect("write readme");

        let candidates = discover_skill_dirs(&root);
        assert_eq!(candidates.len(), 3);

        let names: Vec<&str> = candidates
            .iter()
            .filter_map(|c| c.parsed_name.as_deref())
            .collect();
        assert!(names.contains(&"ui-ux-pro-max"));
        assert!(names.contains(&"design"));
        assert!(names.contains(&"brand"));

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn discover_skill_dirs_finds_root_level_skill() {
        // Single-skill repo where SKILL.md is at the root
        let root = test_dir("discover-root");
        fs::write(
            root.join("SKILL.md"),
            "---\nname: root-skill\ndescription: at root\n---\nBody",
        )
        .expect("write skill");

        let candidates = discover_skill_dirs(&root);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].parsed_name.as_deref(), Some("root-skill"));
        assert_eq!(candidates[0].dir, root);

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn detect_collection_from_symlinked_skill_md() {
        // Simulate: skills_root/gstack/browse/SKILL.md exists
        //           skills_root/browse/SKILL.md → skills_root/gstack/browse/SKILL.md
        let root = test_dir("detect-collection");
        let collection_skill = root.join("gstack").join("browse");
        fs::create_dir_all(&collection_skill).expect("create collection skill dir");
        fs::write(
            collection_skill.join("SKILL.md"),
            "---\nname: browse\ndescription: test\n---\nBody",
        )
        .expect("write skill");

        // Create top-level dir with symlinked SKILL.md
        let top_level = root.join("browse");
        fs::create_dir_all(&top_level).expect("create top level dir");
        std::os::unix::fs::symlink(
            collection_skill.join("SKILL.md"),
            top_level.join("SKILL.md"),
        )
        .expect("create symlink");

        let result = detect_collection(&top_level, &root);
        assert_eq!(result, Some("gstack".to_string()));

        // Non-collection skill returns None
        let standalone = root.join("standalone");
        fs::create_dir_all(&standalone).expect("create standalone dir");
        fs::write(
            standalone.join("SKILL.md"),
            "---\nname: standalone\ndescription: test\n---\nBody",
        )
        .expect("write skill");
        let result = detect_collection(&standalone, &root);
        assert_eq!(result, None);

        let _ = fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn detect_collection_from_symlinked_dir() {
        // Simulate: skills_root/gstack/qa/ has SKILL.md
        //           skills_root/qa → skills_root/gstack/qa (dir symlink)
        let root = test_dir("detect-collection-dir");
        let collection_skill = root.join("gstack").join("qa");
        fs::create_dir_all(&collection_skill).expect("create dir");
        fs::write(
            collection_skill.join("SKILL.md"),
            "---\nname: qa\ndescription: test\n---\nBody",
        )
        .expect("write skill");

        std::os::unix::fs::symlink(&collection_skill, root.join("qa")).expect("create symlink");

        let result = detect_collection(&root.join("qa"), &root);
        assert_eq!(result, Some("gstack".to_string()));

        let _ = fs::remove_dir_all(&root);
    }
}
