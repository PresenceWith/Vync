#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"

echo "[vync] Installing Claude Code plugin..."

# 1. Skills
mkdir -p "$CLAUDE_DIR/skills"
if [ -L "$CLAUDE_DIR/skills/vync-editing" ]; then
  rm "$CLAUDE_DIR/skills/vync-editing"
fi
ln -s "$SCRIPT_DIR/skills/vync-editing" "$CLAUDE_DIR/skills/vync-editing"
echo "  [ok] Skill: vync-editing"

# 2. Commands
mkdir -p "$CLAUDE_DIR/commands"
for cmd in vync.md; do
  target="$CLAUDE_DIR/commands/$cmd"
  [ -L "$target" ] && rm "$target"
  [ -f "$target" ] && rm "$target"
  ln -s "$SCRIPT_DIR/commands/$cmd" "$target"
  echo "  [ok] Command: /${cmd%.md}"
done

# Remove deprecated /vync-create (merged into /vync create)
deprecated="$CLAUDE_DIR/commands/vync-create.md"
[ -L "$deprecated" ] && rm "$deprecated" && echo "  [ok] Removed deprecated: /vync-create"
[ -f "$deprecated" ] && rm "$deprecated" && echo "  [ok] Removed deprecated: /vync-create"

# 3. Agents
agents_dir="$CLAUDE_DIR/agents"
mkdir -p "$agents_dir"
for agent in vync-translator.md; do
  src="$SCRIPT_DIR/agents/$agent"
  dst="$agents_dir/$agent"
  [ -L "$dst" ] && rm "$dst"
  ln -s "$src" "$dst" && echo "  [ok] Agent: ${agent%.md}"
done

# 4. Hooks — merge into settings.json (with backup)
SETTINGS="$CLAUDE_DIR/settings.json"
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi

# Backup existing settings
cp "$SETTINGS" "$SETTINGS.bak"
echo "  [ok] Backup: $SETTINGS.bak"

# Use node to safely merge hooks (preserve existing fields)
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
const hooks = JSON.parse(fs.readFileSync('$SCRIPT_DIR/hooks.json', 'utf-8'));

// Merge hooks: append vync hooks to existing arrays
if (!settings.hooks) settings.hooks = {};
for (const [event, entries] of Object.entries(hooks.hooks)) {
  if (!settings.hooks[event]) settings.hooks[event] = [];
  // Remove existing vync hooks first (idempotent)
  settings.hooks[event] = settings.hooks[event].filter(
    e => !JSON.stringify(e).includes('vync')
  );
  settings.hooks[event].push(...entries);
}

// Set VYNC_HOME env
if (!settings.env) settings.env = {};
settings.env.VYNC_HOME = '$PROJECT_ROOT';

fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
"
echo "  [ok] Hooks: PostToolUse, SessionEnd"
echo "  [ok] Env: VYNC_HOME=$PROJECT_ROOT"

# 5. CLI access via PATH (no npm link — private: true)
echo ""
echo "[vync] Installation complete!"
echo "  Restart Claude Code to activate."
echo ""
echo "  To use 'vync' CLI from any directory, add to your shell profile:"
echo "    export PATH=\"$PROJECT_ROOT/bin:\$PATH\""
