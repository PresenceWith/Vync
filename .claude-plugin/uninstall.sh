#!/usr/bin/env bash
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"

echo "[vync] Uninstalling Claude Code plugin..."

# 1. Remove symlinks
rm -f "$CLAUDE_DIR/skills/vync-editing"
rm -f "$CLAUDE_DIR/commands/vync.md"
rm -f "$CLAUDE_DIR/commands/vync-create.md"
rm -f "$CLAUDE_DIR/agents/vync-translator.md"
echo "  [ok] Removed skills, commands, and agents"

# 2. Remove hooks from settings.json
SETTINGS="$CLAUDE_DIR/settings.json"
if [ -f "$SETTINGS" ]; then
  node -e "
  const fs = require('fs');
  const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(
        e => !JSON.stringify(e).includes('vync')
      );
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }
  if (settings.env) {
    delete settings.env.VYNC_HOME;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }
  fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
  "
  echo "  [ok] Removed hooks and VYNC_HOME"
fi

echo ""
echo "[vync] Uninstallation complete."
