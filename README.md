# Vync

**Visual Sync** — A local-first visual planning tool with real-time bidirectional sync.

Your `.vync` file is the single source of truth. Edit it from the web UI, desktop app, Claude Code, or any text editor — changes sync instantly everywhere.

## Features

- **Local-first**: `.vync` JSON files live on your filesystem. No cloud, no account required.
- **Real-time sync**: File changes (from any editor) reflect in the UI instantly via WebSocket + chokidar.
- **AI-native editing**: Claude Code can create and edit diagrams directly via the plugin.
- **Mind maps, flowcharts, diagrams**: Built on the [Plait](https://github.com/worktile/plait) framework.
- **Electron desktop app**: Native macOS app with file associations (`.vync`).
- **CLI-first workflow**: `vync init`, `vync open`, `vync stop`.
- **Infinite canvas**: Zoom, scroll, pan. Auto-save. Undo/redo.

## Quick Start

### Prerequisites

- Node.js 18+
- npm 9+

### Install

```bash
git clone https://github.com/PresenceWith/Vync.git
cd Vync
npm install
```

### Add CLI to PATH

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
export PATH="/path/to/Vync/bin:$PATH"
```

### Usage

```bash
# Create a new canvas
vync init my-plan        # creates .vync/my-plan.vync

# Open in browser (starts server on :3100)
vync open my-plan

# Stop the server
vync stop
```

### Development

```bash
# Dev server (Vite + Express + WebSocket on :3100)
npm run dev:server

# Electron desktop (dev mode)
npm run dev:desktop

# Build web
npm run build:web

# Package desktop app (macOS DMG)
npm run package:desktop
```

## Claude Code Plugin

Vync includes a Claude Code plugin that lets AI create and edit `.vync` diagrams.

### Plugin Install

**Option A: Marketplace (recommended)**

In Claude Code, run:
```
/plugin install vync
```

Or add the marketplace source:
```
/plugin marketplace add PresenceWith/Vync
```

**Option B: Manual install**

```bash
bash .claude-plugin/install.sh
```

This installs:
- **Skills**: `vync-editing` — guides Claude Code to correctly edit `.vync` files
- **Commands**: `/vync` (init/open/stop/read), `/vync-create` (create diagrams from text)
- **Hooks**: Auto-validation on `.vync` file edits, server cleanup on session end

### Example: AI-generated diagram

```
/vync-create mindmap Project planning for Q2 launch
```

Claude Code will generate a valid `.vync` mindmap file following the PlaitElement schema.

## Architecture

```
Vync/
├── apps/web/               # Vite SPA (React 19 + Plait)
├── packages/
│   ├── board/               # Whiteboard UI library (@vync/board)
│   ├── react-board/         # Plait ↔ React bridge
│   ├── react-text/          # Text rendering (Slate)
│   └── shared/              # Shared types and utilities (@vync/shared)
├── tools/
│   ├── server/              # Express + Vite middleware + WebSocket
│   ├── cli/                 # CLI commands (init, open, stop)
│   └── electron/            # Electron main + preload
├── .claude-plugin/          # Claude Code integration (marketplace plugin)
│   ├── plugin.json          # Plugin metadata
│   ├── skills/vync-editing/ # AI editing skill
│   ├── commands/            # Slash commands
│   └── hooks.json           # PostToolUse + SessionEnd hooks
└── bin/vync.js              # CLI entry point
```

### Data Flow

```
.vync file ←→ chokidar (watch) ←→ Server ←→ WebSocket ←→ Browser UI
                                     ↕
                              Claude Code / vim / any editor
```

### .vync File Format

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [
    { "id": "AbCdE", "type": "mindmap", "data": { ... }, "children": [ ... ] }
  ]
}
```

## Acknowledgments

Vync is built on top of [Drawnix](https://github.com/plait-board/drawnix), an open-source whiteboard tool powered by the [Plait](https://github.com/worktile/plait) framework. Thanks to the Drawnix and Plait teams for their foundational work.

## License

[MIT](LICENSE)
