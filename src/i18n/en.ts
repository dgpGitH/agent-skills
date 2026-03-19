const en = {
  // === Layout / Sidebar ===
  sidebar: {
    dashboard: "Dashboard",
    skills: "Skills",
    marketplace: "Marketplace",
    settings: "Settings",
  },

  // === Dashboard ===
  dashboard: {
    title: "Dashboard",
    detectedAgents: "Detected Agents",
    installedSkills: "Installed Skills",
    agents: "Agents",
    detectedOf: "{{detected}} of {{total}} detected",
    refreshTitle: "Refresh agents and skills",
    searchPlaceholder: "Search name / slug / path...",
    filterAll: "All",
    filterDetected: "Detected",
    filterNotInstalled: "Not Installed",
    sortName: "Sort: Name",
    sortSkills: "Sort: Skills",
    loadingAgents: "Loading agents...",
    noAgentsMatch: "No agents match current filters.",
    detected: "Detected",
    skillCount: "{{count}} skill installed",
    skillCount_other: "{{count}} skills installed",
    notInstalled: "Not installed",
    installationGuide: "Installation Guide",
    recentSkills: "Recent Skills",
    viewAll: "View all",
    scanning: "Scanning...",
    noSkillsYet: "No skills installed yet.",
    browseMarketplace: "Browse Marketplace",
    // Install Guide Modal
    installGuideTitle: "{{name}} installation guide",
    source: "Source",
    diagnoseTip: "Use the commands below to diagnose installation and PATH status quickly.",
    versionCheck: "Version check",
    pathLookup: "PATH lookup",
    installCommand: "Install command",
    openDocs: "Open official install docs",
    expectedPaths: "Expected skill paths",
    copy: "Copy",
    // Install source labels
    sourceOfficialDocs: "Official Docs",
    sourceOfficialHelpCenter: "Official Help Center",
    sourceOfficialReadme: "Official README",
    sourceOfficialMarketplace: "Official Marketplace",
    sourceHomebrewCask: "Homebrew Cask",
    sourceUnspecified: "Unspecified",
  },

  // === Skills Manager ===
  skills: {
    title: "Skills",
    filterAll: "All",
    filterPlaceholder: "Filter skills...",
    scanningSkills: "Scanning skills...",
    noSkillsFound: "No skills found.",
    detail: "Detail",
    revealInFinder: "Reveal in Finder",
    // Package Info
    packageInfo: "Package Info",
    sourceLabel: "Source",
    repository: "Repository",
    id: "ID",
    scope: "Scope",
    scopeGlobal: "Global",
    scopeLocal: "{{name}} Local",
    sourceLocalPath: "Local",
    sourceGit: "Git",
    sourceSkillsSh: "skills.sh",
    sourceClawHub: "ClawHub",
    sourceUnknown: "Unknown",
    // Metadata
    skillMetadata: "Skill Metadata",
    // Agent Assignment
    agentsLabel: "Agents ({{installed}}/{{total}})",
    via: "via {{name}}",
    symlink: "symlink",
    install: "Install",
    uninstall: "Uninstall",
    // Actions
    actions: "Actions",
    editSkillMd: "Edit SKILL.md",
    syncTo: "Sync to {{names}}",
    // Skill Content
    skillContent: "Skill Content",
    loading: "Loading...",
    noContent: "No content available",
    // Editor
    backToDetail: "Back to detail",
    save: "Save",
    failedToLoad: "# Failed to load SKILL.md",
  },

  // === Marketplace ===
  marketplace: {
    title: "Marketplace",
    searchPlaceholder: "Search {{source}}...",
    loading: "Loading...",
    failedToLoad: "Failed to load: {{error}}",
    noSkillsFound: "No skills found.",
    detail: "Detail",
    installed: "Installed",
    installAll: "Install All",
    installing: "Installing...",
    install: "Install",
    agentsLabel: "Agents ({{installed}}/{{total}})",
    // Package Info
    packageInfo: "Package Info",
    repository: "Repository",
    installs: "Installs",
    // Actions
    actions: "Actions",
    viewRepository: "View Repository",
    viewOnSkillsSh: "View on skills.sh",
    // Skill Content
    skillContent: "Skill Content",
    couldNotLoad: "Could not load content from repository",
    noRepoUrl: "No repository URL available",
    // Sorts
    sortAllTime: "All Time",
    sortTrending: "Trending",
    sortHot: "Hot",
    sortDefault: "Default",
    sortDownloads: "Downloads",
    sortStars: "Stars",
  },

  // === Settings ===
  settings: {
    title: "Settings",
    loadingSettings: "Loading settings...",
    // Theme
    theme: "Theme",
    light: "light",
    dark: "dark",
    system: "system",
    // Language
    language: "Language",
    // Marketplace Cache
    marketplaceCache: "Marketplace Cache",
    cacheDescription: "Marketplace results are cached locally for 5 minutes. Clear the cache to force a fresh fetch.",
    clearCache: "Clear Cache",
    cleared: "Cleared",
    // Agent Paths
    agentSkillPaths: "Agent Skill Paths",
    agentPathsDescription: "Default skill directories for each agent.",
    revealInFinder: "Reveal in Finder",
  },
} as const;

export default en;
