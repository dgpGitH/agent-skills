use regex::Regex;
use reqwest::blocking::Client;
use serde::Deserialize;
use thiserror::Error;

use super::cache::{read_cache, read_cache_stale, write_cache};
use super::MarketplaceSkill;

#[derive(Debug, Error)]
pub enum SkillsShError {
    #[error("network error: {0}")]
    Network(#[from] reqwest::Error),
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse error: {0}")]
    Parse(String),
}

/// JSON shape embedded in Next.js RSC payload for each skill
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RscSkill {
    source: String,
    skill_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    installs: Option<u64>,
}

/// Fetch leaderboard from skills.sh by scraping the RSC payload in the HTML
pub fn fetch_skillssh(sort: &str, page: u32) -> Result<Vec<MarketplaceSkill>, SkillsShError> {
    let cache_key = format!("skills.sh:{sort}:{page}");
    if let Ok(Some(cached)) = read_cache(&cache_key) {
        return Ok(cached);
    }

    let url = match sort {
        "trending" => format!("https://skills.sh/trending?page={page}"),
        "hot" => format!("https://skills.sh/hot?page={page}"),
        _ => format!("https://skills.sh/?page={page}"),
    };
    let result = Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()?
        .get(&url)
        .send()
        .and_then(|r| r.text());

    match result {
        Ok(html) => {
            let skills = parse_leaderboard_html(&html);
            let _ = write_cache(&cache_key, &skills, 5 * 60);
            Ok(skills)
        }
        Err(e) => {
            // Serve stale cache on network error
            if let Ok(Some(stale)) = read_cache_stale(&cache_key) {
                return Ok(stale);
            }
            Err(SkillsShError::Network(e))
        }
    }
}

/// Search skills.sh using the JSON search API
pub fn search_skillssh(query: &str) -> Result<Vec<MarketplaceSkill>, SkillsShError> {
    let cache_key = format!("skills.sh:search:{query}");
    if let Ok(Some(cached)) = read_cache(&cache_key) {
        return Ok(cached);
    }

    let url = format!(
        "https://skills.sh/api/search?q={}&limit=50",
        urlencoding::encode(query)
    );
    let result = Client::builder()
        .user_agent("Mozilla/5.0")
        .build()?
        .get(&url)
        .header("Accept", "application/json")
        .send()
        .and_then(|r| r.text());

    match result {
        Ok(resp) => {
            let skills = parse_search_response(&resp);
            let _ = write_cache(&cache_key, &skills, 5 * 60);
            Ok(skills)
        }
        Err(e) => {
            if let Ok(Some(stale)) = read_cache_stale(&cache_key) {
                return Ok(stale);
            }
            Err(SkillsShError::Network(e))
        }
    }
}

/// Parse skills.sh search API JSON response
fn parse_search_response(json_str: &str) -> Vec<MarketplaceSkill> {
    #[derive(Deserialize)]
    struct SearchResponse {
        #[serde(default)]
        skills: Vec<SearchSkill>,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct SearchSkill {
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        skill_id: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        installs: Option<u64>,
    }

    let parsed: SearchResponse = serde_json::from_str(json_str).unwrap_or(SearchResponse {
        skills: Vec::new(),
    });

    parsed
        .skills
        .into_iter()
        .filter_map(|s| {
            let source_path = s.source?;
            let skill_id = s.skill_id?;
            let parts: Vec<&str> = source_path.splitn(2, '/').collect();
            let owner = if parts.len() == 2 {
                parts[0]
            } else {
                source_path.as_str()
            };
            Some(MarketplaceSkill {
                name: s.name.unwrap_or_else(|| skill_id.clone()),
                description: None,
                author: Some(owner.to_string()),
                repository: Some(format!("https://github.com/{source_path}")),
                installs: s.installs,
                source: "skills.sh".to_string(),
            })
        })
        .collect()
}

/// Extract skill data from Next.js RSC payload embedded in HTML.
///
/// Next.js App Router with React Server Components embeds data in
/// `self.__next_f.push()` script tags. We find JSON objects with
/// `skillId` and `installs` fields using regex.
fn parse_leaderboard_html(html: &str) -> Vec<MarketplaceSkill> {
    // Match flat JSON objects containing both "skillId" and "installs"
    let pattern =
        r#"\{[^}]*"skillId"\s*:\s*"[^"]+"[^}]*"installs"\s*:\s*\d+[^}]*\}"#;
    let re = Regex::new(pattern).expect("regex");

    let mut skills: Vec<MarketplaceSkill> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // First pass: match unescaped JSON objects
    for m in re.find_iter(html) {
        if let Some(skill) = try_decode_rsc_skill(m.as_str()) {
            if seen.insert(skill.name.clone()) {
                skills.push(skill);
            }
        }
    }

    // Second pass: search in escaped JSON strings inside __next_f.push() payloads
    if skills.is_empty() {
        let escaped_pattern =
            r#"\{(?:[^{}]|\\[{}])*\\?"skillId\\?"\s*:\\?\s*\\?"[^"\\]+\\?"[^}]*\}"#;
        if let Ok(esc_re) = Regex::new(escaped_pattern) {
            for m in esc_re.find_iter(html) {
                let unescaped = m
                    .as_str()
                    .replace("\\\"", "\"")
                    .replace("\\\\/", "/")
                    .replace("\\\\", "\\");
                if let Some(skill) = try_decode_rsc_skill(&unescaped) {
                    if seen.insert(skill.name.clone()) {
                        skills.push(skill);
                    }
                }
            }
        }
    }

    skills
}

/// Try to decode a JSON string as an RscSkill and convert to MarketplaceSkill
fn try_decode_rsc_skill(json_str: &str) -> Option<MarketplaceSkill> {
    let rsc: RscSkill = serde_json::from_str(json_str).ok()?;
    let parts: Vec<&str> = rsc.source.splitn(2, '/').collect();
    let owner = if parts.len() == 2 {
        parts[0]
    } else {
        rsc.source.as_str()
    };
    Some(MarketplaceSkill {
        name: rsc.name.unwrap_or_else(|| rsc.skill_id.clone()),
        description: None,
        author: Some(owner.to_string()),
        repository: Some(format!("https://github.com/{}", rsc.source)),
        installs: rsc.installs,
        source: "skills.sh".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_rsc_payload() {
        // Simulate RSC payload with embedded skill JSON objects
        let html = r#"<script>self.__next_f.push([1,"something {\"source\":\"acme/skill-repo\",\"skillId\":\"my-skill\",\"name\":\"My Skill\",\"installs\":1200} more"])</script>
        <script>self.__next_f.push([1,"{\"source\":\"demo/repo\",\"skillId\":\"other-skill\",\"name\":\"Other\",\"installs\":500}"])</script>"#;
        let skills = parse_leaderboard_html(html);
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].name, "My Skill");
        assert_eq!(skills[0].installs, Some(1200));
        assert_eq!(skills[0].author, Some("acme".to_string()));
        assert_eq!(
            skills[0].repository,
            Some("https://github.com/acme/skill-repo".to_string())
        );
        assert_eq!(skills[1].name, "Other");
    }

    #[test]
    fn parse_search_json() {
        let json = r#"{"skills":[{"source":"vercel-labs/skills","skillId":"find-skills","name":"find-skills","installs":565200}]}"#;
        let skills = parse_search_response(json);
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "find-skills");
        assert_eq!(skills[0].author, Some("vercel-labs".to_string()));
    }
}
