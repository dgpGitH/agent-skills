use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SkillSource {
    LocalPath { path: String },
    GitRepository { repo_url: String, skill_path: Option<String> },
    SkillsSh { repository: Option<String> },
    ClawHub { repository: Option<String> },
    Unknown,
}

/// Scope of a skill installation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "type")]
pub enum SkillScope {
    /// Located in a shared global directory, referenced by multiple agents via symlink.
    #[default]
    SharedGlobal,
    /// Only in a specific agent's skills directory (not a symlink).
    AgentLocal { agent: String },
}

/// Records one installation of a skill under a specific agent.
/// Mirrors Swift SkillInstallation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillInstallation {
    /// Agent slug (e.g. "claude-code")
    pub agent_slug: String,
    /// Path of the skill directory under this agent
    pub path: String,
    /// Whether the entry is a symlink (vs original directory)
    pub is_symlink: bool,
    /// Whether this is an inherited installation (from another agent's readable directory)
    pub is_inherited: bool,
    /// Source agent slug when inherited
    pub inherited_from: Option<String>,
}

/// Core data model representing an AI agent skill.
/// Deduplication key is `id` (the directory name).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Skill {
    /// Unique identifier: skill directory name (e.g. "agent-notifier")
    pub id: String,
    /// Display name (from SKILL.md frontmatter `name`, falls back to id)
    pub name: String,
    pub description: Option<String>,
    /// Canonical path (real path after resolving symlinks)
    pub canonical_path: String,
    pub source: Option<SkillSource>,
    pub metadata: Option<serde_json::Value>,
    /// Scope: SharedGlobal if found in multiple agents or shared dir, otherwise AgentLocal
    pub scope: SkillScope,
    /// Per-agent installation records
    pub installations: Vec<SkillInstallation>,
}

impl Skill {
    /// Convenience: list of agent slugs that have this skill installed (non-inherited only by default)
    pub fn installed_agents(&self) -> Vec<String> {
        self.installations
            .iter()
            .filter(|i| !i.is_inherited)
            .map(|i| i.agent_slug.clone())
            .collect()
    }

    /// All agent slugs (including inherited)
    pub fn all_agents(&self) -> Vec<String> {
        self.installations
            .iter()
            .map(|i| i.agent_slug.clone())
            .collect()
    }

    /// Per-agent paths (for backward compat with frontend)
    pub fn agent_paths(&self) -> HashMap<String, String> {
        self.installations
            .iter()
            .map(|i| (i.agent_slug.clone(), i.path.clone()))
            .collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SkillSummary {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub installed_agents: Vec<String>,
}

/// Progress event emitted during batch skill updates.
#[derive(Debug, Clone, Serialize)]
pub struct UpdateProgress {
    pub done: usize,
    pub total: usize,
    pub current_skill: String,
}

/// Result of a batch update operation.
#[derive(Debug, Clone, Serialize, Default)]
pub struct UpdateAllResult {
    pub updated: Vec<String>,
    pub failed: Vec<(String, String)>,
    pub skipped: usize,
}
