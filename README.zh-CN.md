<p align="center">
  <img src="src-tauri/icons/icon-rounded.png" width="128" height="128" alt="AgentSkills Logo">
</p>

<h1 align="center">AgentSkills</h1>

<p align="center">
  跨平台桌面应用，用于管理 AI 代理技能。<br>
  通过统一界面浏览、安装、同步和编辑 13 个代理的技能。
</p>

<p align="center">
  <a href="https://github.com/anthropics/agent-skills/releases"><img src="https://img.shields.io/github/v/release/anthropics/agent-skills?style=flat-square" alt="Release"></a>
  <a href="https://github.com/anthropics/agent-skills/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <a href="https://github.com/anthropics/agent-skills/stargazers"><img src="https://img.shields.io/github/stars/anthropics/agent-skills?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="./README.md">English</a>
</p>

---

## 支持的 AI 工具

- Claude Code
- Cursor
- Codex
- Gemini CLI
- GitHub Copilot CLI
- Kiro
- OpenCode
- Antigravity
- CodeBuddy
- OpenClaw
- Trae
- Windsurf
- Cline

## 功能

- **仪表盘** — 查看已安装的代理及每个代理的技能数量
- **技能管理** — 查看、编辑、卸载技能，跨代理同步
- **市场** — 从 [skills.sh](https://skills.sh) 和 [ClawHub](https://clawhub.ai) 浏览并安装技能
- **技能编辑器** — 在应用内直接编辑 SKILL.md 文件
- **文件监听** — 磁盘上技能变化时自动刷新
- **跨代理同步** — 一键将技能从一个代理同步到所有其他代理

## 技术栈

**前端：** React 19、TypeScript、Tailwind CSS 4、shadcn/ui

**原生核心层：** Rust、Tauri 2、SQLite

## 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Tauri 平台依赖 — 参见 [Tauri 环境配置](https://v2.tauri.app/start/prerequisites/)

### 开发

```bash
# 安装依赖
npm install

# 启动开发环境（Vite + Tauri）
npm run tauri dev

# 仅前端（端口 1420）
npm run dev

# 类型检查
npx tsc

# Rust 测试
cd src-tauri && cargo test
```

### 构建

```bash
npm run tauri build
```

### 下载

- **macOS：** `AgentSkills.app` + `.dmg`
- **Windows：** `.msi` + `.exe`
- **Linux：** `.AppImage` + `.deb`
- 发布页：[GitHub Releases](https://github.com/anthropics/agent-skills/releases)

## 贡献

欢迎贡献！请先开 Issue 讨论你想要做的改动。

## 许可证

[MIT](./LICENSE)
