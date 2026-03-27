use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use super::MarketplaceSkill;

pub fn cache_db_path() -> PathBuf {
    let base = dirs::cache_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("skills-app");
    let _ = fs::create_dir_all(&base);
    base.join("marketplace.db")
}

pub fn open_cache() -> Result<Connection, String> {
    let conn = Connection::open(cache_db_path()).map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS marketplace_cache (
            cache_key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            expires_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

pub fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn read_cache(key: &str) -> Result<Option<Vec<MarketplaceSkill>>, String> {
    let conn = open_cache()?;
    let mut stmt = conn
        .prepare("SELECT payload, expires_at FROM marketplace_cache WHERE cache_key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let payload: String = row.get(0).map_err(|e| e.to_string())?;
    let expires_at: i64 = row.get(1).map_err(|e| e.to_string())?;
    if expires_at < now_epoch() {
        return Ok(None);
    }
    let parsed: Vec<MarketplaceSkill> = serde_json::from_str(&payload).unwrap_or_default();
    Ok(Some(parsed))
}

/// Read a cache entry even if it has expired (for serve-stale-on-error).
pub fn read_cache_stale(key: &str) -> Result<Option<Vec<MarketplaceSkill>>, String> {
    let conn = open_cache()?;
    let mut stmt = conn
        .prepare("SELECT payload FROM marketplace_cache WHERE cache_key = ?1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let payload: String = row.get(0).map_err(|e| e.to_string())?;
    let parsed: Vec<MarketplaceSkill> = serde_json::from_str(&payload).unwrap_or_default();
    if parsed.is_empty() {
        return Ok(None);
    }
    Ok(Some(parsed))
}

pub fn write_cache(
    key: &str,
    skills: &[MarketplaceSkill],
    ttl_seconds: i64,
) -> Result<(), String> {
    let conn = open_cache()?;
    let payload = serde_json::to_string(skills).unwrap_or_default();
    conn.execute(
        "INSERT INTO marketplace_cache(cache_key, payload, expires_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(cache_key) DO UPDATE SET
           payload=excluded.payload,
           expires_at=excluded.expires_at",
        params![key, payload, now_epoch() + ttl_seconds],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
