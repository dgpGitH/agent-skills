<p align="center">
  <img src="src-tauri/icons/icon-rounded.png" width="128" height="128" alt="AgentSkills Logo">
</p>

<h1 align="center">AgentSkills</h1>

<p align="center">
  A cross-platform desktop app for managing AI agent skills.<br>
  Browse, install, sync, and edit skills across 13 agents from a single interface.
</p>

<p align="center">
  <a href="https://github.com/anthropics/agent-skills/releases"><img src="https://img.shields.io/github/v/release/anthropics/agent-skills?style=flat-square" alt="Release"></a>
  <a href="https://github.com/anthropics/agent-skills/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <a href="https://github.com/anthropics/agent-skills/stargazers"><img src="https://img.shields.io/github/stars/anthropics/agent-skills?style=flat-square" alt="Stars"></a>
</p>

<p align="center">
  <a href="./README.zh-CN.md">中文</a>
</p>

---

## Supported AI Tools

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

## Features

- **Dashboard** — See which agents are installed, how many skills each has
- **Skills Manager** — View, edit, uninstall, and sync skills across agents
- **Marketplace** — Browse and install skills from [skills.sh](https://skills.sh) and [ClawHub](https://clawhub.ai)
- **Skill Editor** — Edit SKILL.md files directly in the app
- **File Watcher** — Auto-refreshes when skills change on disk
- **Cross-Agent Sync** — Install a skill to one agent, sync it to all others in one click

## Tech Stack

**Frontend:** React 19, TypeScript, Tailwind CSS 4, shadcn/ui

**Native Core:** Rust, Tauri 2, SQLite

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)
- Platform-specific Tauri dependencies — see [Tauri Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
# Install dependencies
npm install

# Run in development (starts Vite + Tauri)
npm run tauri dev

# Frontend only (port 1420)
npm run dev

# Type check
npx tsc

# Rust tests
cd src-tauri && cargo test
```

### Build

```bash
npm run tauri build
```

### Downloads

- **macOS:** `AgentSkills.app` + `.dmg`
- **Windows:** `.msi` + `.exe`
- **Linux:** `.AppImage` + `.deb`
- Release page: [GitHub Releases](https://github.com/anthropics/agent-skills/releases)

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

## License

[MIT](./LICENSE)
