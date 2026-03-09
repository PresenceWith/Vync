#!/usr/bin/env bash
set -euo pipefail

CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"

echo "[vync] Uninstalling Claude Code plugin..."

# 1. Remove legacy symlinks
rm -f "$CLAUDE_DIR/skills/vync-editing"
rm -f "$CLAUDE_DIR/commands/vync.md"
rm -f "$CLAUDE_DIR/commands/vync-create.md"
rm -f "$CLAUDE_DIR/agents/vync-translator.md"

# 2. Clean settings.json
if [ -f "$SETTINGS" ]; then
  cp "$SETTINGS" "$SETTINGS.bak"
  node -e "
  const fs = require('fs');
  const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));

  // Remove marketplace registration
  if (settings.extraKnownMarketplaces) {
    delete settings.extraKnownMarketplaces['PresenceWith-Vync'];
    if (Object.keys(settings.extraKnownMarketplaces).length === 0) delete settings.extraKnownMarketplaces;
  }

  // Remove enabled plugin
  if (settings.enabledPlugins) {
    delete settings.enabledPlugins['vync@PresenceWith-Vync'];
  }

  // Remove VYNC_HOME
  if (settings.env) {
    delete settings.env.VYNC_HOME;
    if (Object.keys(settings.env).length === 0) delete settings.env;
  }

  // Remove legacy hooks
  if (settings.hooks) {
    for (const event of Object.keys(settings.hooks)) {
      settings.hooks[event] = settings.hooks[event].filter(
        e => !JSON.stringify(e).includes('vync')
      );
      if (settings.hooks[event].length === 0) delete settings.hooks[event];
    }
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  }

  fs.writeFileSync('$SETTINGS', JSON.stringify(settings, null, 2));
  "
  echo "  [ok] Removed marketplace, plugin, VYNC_HOME, and hooks"
fi

# 3. Remove from installed_plugins.json
INSTALLED="$CLAUDE_DIR/plugins/installed_plugins.json"
if [ -f "$INSTALLED" ]; then
  node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('$INSTALLED', 'utf-8'));
  if (data.plugins) {
    delete data.plugins['vync@PresenceWith-Vync'];
  }
  fs.writeFileSync('$INSTALLED', JSON.stringify(data, null, 2));
  "
  echo "  [ok] Removed from installed_plugins.json"
fi

# 4. Remove plugin cache (handles both symlinks and real directories)
rm -rf "$CLAUDE_DIR/plugins/cache/PresenceWith-Vync"
echo "  [ok] Removed plugin cache"

echo ""
echo "[vync] Uninstallation complete."
