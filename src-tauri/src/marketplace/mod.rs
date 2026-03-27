pub mod cache;
pub mod clawhub;
pub mod skillssh;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct MarketplaceSkill {
    pub name: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub repository: Option<String>,
    pub installs: Option<u64>,
    pub source: String,
}
