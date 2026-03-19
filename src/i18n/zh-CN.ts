const zhCN = {
  // === Layout / Sidebar ===
  sidebar: {
    dashboard: "仪表盘",
    skills: "技能管理",
    marketplace: "市场",
    settings: "设置",
  },

  // === Dashboard ===
  dashboard: {
    title: "仪表盘",
    detectedAgents: "已检测 Agent",
    installedSkills: "已安装技能",
    agents: "Agent 列表",
    detectedOf: "已检测 {{detected}} / {{total}}",
    refreshTitle: "刷新 Agent 和技能",
    searchPlaceholder: "搜索名称 / 标识 / 路径...",
    filterAll: "全部",
    filterDetected: "已检测",
    filterNotInstalled: "未安装",
    sortName: "排序: 名称",
    sortSkills: "排序: 技能数",
    loadingAgents: "正在加载 Agent...",
    noAgentsMatch: "没有匹配的 Agent。",
    detected: "已检测",
    skillCount: "已安装 {{count}} 个技能",
    skillCount_other: "已安装 {{count}} 个技能",
    notInstalled: "未安装",
    installationGuide: "安装指南",
    recentSkills: "最近的技能",
    viewAll: "查看全部",
    scanning: "扫描中...",
    noSkillsYet: "尚未安装任何技能。",
    browseMarketplace: "浏览市场",
    // Install Guide Modal
    installGuideTitle: "{{name}} 安装指南",
    source: "来源",
    diagnoseTip: "使用以下命令快速诊断安装和 PATH 状态。",
    versionCheck: "版本检查",
    pathLookup: "PATH 查找",
    installCommand: "安装命令",
    openDocs: "打开官方安装文档",
    expectedPaths: "预期技能路径",
    copy: "复制",
    // Install source labels
    sourceOfficialDocs: "官方文档",
    sourceOfficialHelpCenter: "官方帮助中心",
    sourceOfficialReadme: "官方 README",
    sourceOfficialMarketplace: "官方市场",
    sourceHomebrewCask: "Homebrew Cask",
    sourceUnspecified: "未指定",
  },

  // === Skills Manager ===
  skills: {
    title: "技能管理",
    filterAll: "全部",
    filterPlaceholder: "搜索技能...",
    scanningSkills: "正在扫描技能...",
    noSkillsFound: "未找到技能。",
    detail: "详情",
    revealInFinder: "在 Finder 中显示",
    // Package Info
    packageInfo: "包信息",
    sourceLabel: "来源",
    repository: "仓库",
    id: "ID",
    scope: "作用域",
    scopeGlobal: "全局",
    scopeLocal: "{{name}} 本地",
    sourceLocalPath: "本地",
    sourceGit: "Git",
    sourceSkillsSh: "skills.sh",
    sourceClawHub: "ClawHub",
    sourceUnknown: "未知",
    // Metadata
    skillMetadata: "技能元数据",
    // Agent Assignment
    agentsLabel: "Agent ({{installed}}/{{total}})",
    via: "来自 {{name}}",
    symlink: "符号链接",
    install: "安装",
    uninstall: "卸载",
    // Actions
    actions: "操作",
    editSkillMd: "编辑 SKILL.md",
    syncTo: "同步至 {{names}}",
    // Skill Content
    skillContent: "技能内容",
    loading: "加载中...",
    noContent: "暂无内容",
    // Editor
    backToDetail: "返回详情",
    save: "保存",
    failedToLoad: "# 加载 SKILL.md 失败",
  },

  // === Marketplace ===
  marketplace: {
    title: "市场",
    searchPlaceholder: "搜索 {{source}}...",
    loading: "加载中...",
    failedToLoad: "加载失败: {{error}}",
    noSkillsFound: "未找到技能。",
    detail: "详情",
    installed: "已安装",
    installAll: "全部安装",
    installing: "安装中...",
    install: "安装",
    agentsLabel: "Agent ({{installed}}/{{total}})",
    // Package Info
    packageInfo: "包信息",
    repository: "仓库",
    installs: "安装量",
    // Actions
    actions: "操作",
    viewRepository: "查看仓库",
    viewOnSkillsSh: "在 skills.sh 上查看",
    // Skill Content
    skillContent: "技能内容",
    couldNotLoad: "无法从仓库加载内容",
    noRepoUrl: "无可用仓库 URL",
    // Sorts
    sortAllTime: "全部时间",
    sortTrending: "趋势",
    sortHot: "热门",
    sortDefault: "默认",
    sortDownloads: "下载量",
    sortStars: "星标",
  },

  // === Settings ===
  settings: {
    title: "设置",
    loadingSettings: "正在加载设置...",
    // Theme
    theme: "主题",
    light: "浅色",
    dark: "深色",
    system: "跟随系统",
    // Language
    language: "语言",
    // Marketplace Cache
    marketplaceCache: "市场缓存",
    cacheDescription: "市场数据本地缓存 5 分钟。清除缓存以强制重新获取。",
    clearCache: "清除缓存",
    cleared: "已清除",
    // Agent Paths
    agentSkillPaths: "Agent 技能路径",
    agentPathsDescription: "各 Agent 的默认技能目录。",
    revealInFinder: "在 Finder 中显示",
  },
} as const;

export default zhCN;
