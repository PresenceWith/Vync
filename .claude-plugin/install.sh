#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"

echo "[vync] Setting up Claude Code plugin..."

# 0. Ensure settings.json exists
if [ ! -f "$SETTINGS" ]; then
  echo '{}' > "$SETTINGS"
fi
cp "$SETTINGS" "$SETTINGS.bak"

# 1. Clean up legacy symlinks (from pre-marketplace install)
for f in "$CLAUDE_DIR/skills/vync-editing" \
         "$CLAUDE_DIR/commands/vync.md" \
         "$CLAUDE_DIR/commands/vync-create.md" \
         "$CLAUDE_DIR/agents/vync-translator.md"; do
  [ -L "$f" ] && rm "$f"
done

# 2. Register marketplace + enable plugin + VYNC_HOME + clean legacy hooks
node -e "
const fs = require('fs');
const settings = JSON.parse(fs.readFileSync('$SETTINGS', 'utf-8'));

// Register local directory as marketplace source
if (!settings.extraKnownMarketplaces) settings.extraKnownMarketplaces = {};
settings.extraKnownMarketplaces['PresenceWith-Vync'] = {
  source: { source: 'directory', path: '$PROJECT_ROOT' }
};

// Enable plugin
if (!settings.enabledPlugins) settings.enabledPlugins = {};
settings.enabledPlugins['vync@PresenceWith-Vync'] = true;

// Set VYNC_HOME (used by CLI)
if (!settings.env) settings.env = {};
settings.env.VYNC_HOME = '$PROJECT_ROOT';

// Clean legacy hooks (from old install.sh that merged into settings.json)
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
echo "  [ok] Marketplace: PresenceWith-Vync (local: $PROJECT_ROOT)"
echo "  [ok] Plugin: vync@PresenceWith-Vync enabled"
echo "  [ok] Env: VYNC_HOME=$PROJECT_ROOT"

# 3. Copy plugin commands to project-level .claude/commands/ (non-namespaced access)
mkdir -p "$PROJECT_ROOT/.claude/commands"
cp "$PROJECT_ROOT/commands/vync.md" "$PROJECT_ROOT/.claude/commands/vync.md"
echo "  [ok] Project command: /vync (non-namespaced alias)"

# 4. Sync plugin cache via rsync (Claude Code copies symlinks to real dirs, so rsync is required)
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PROJECT_ROOT/.claude-plugin/plugin.json','utf8')).version)")
CACHE_BASE="$CLAUDE_DIR/plugins/cache/PresenceWith-Vync/vync"

# Remove old version caches
if [ -d "$CACHE_BASE" ]; then
  for d in "$CACHE_BASE"/*/; do
    [ -d "$d" ] || continue
    dname=$(basename "$d")
    if [ "$dname" != "$VERSION" ]; then
      rm -rf "$d"
      echo "  [ok] Removed old cache: v$dname"
    fi
  done
fi

# Sync current version to cache
CACHE_DIR="$CACHE_BASE/$VERSION"
# Remove stale symlink if exists (from previous symlink attempt)
[ -L "$CACHE_DIR" ] && rm "$CACHE_DIR"
mkdir -p "$CACHE_DIR"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude 'build' \
  --exclude '.worktrees' \
  --exclude '.vync' \
  --exclude '*.lastread' \
  "$PROJECT_ROOT/" "$CACHE_DIR/"
echo "  [ok] Cache synced: v$VERSION"

# 5. Update installed_plugins.json (Claude Code reads active version from here)
INSTALLED="$CLAUDE_DIR/plugins/installed_plugins.json"
node -e "
const fs = require('fs');
const path = '$INSTALLED';
let data = { version: 2, plugins: {} };
if (fs.existsSync(path)) {
  try { data = JSON.parse(fs.readFileSync(path, 'utf-8')); } catch {}
}
if (!data.plugins) data.plugins = {};
const now = new Date().toISOString();
data.plugins['vync@PresenceWith-Vync'] = [{
  scope: 'user',
  installPath: '$CACHE_DIR',
  version: '$VERSION',
  installedAt: (data.plugins['vync@PresenceWith-Vync']?.[0]?.installedAt) || now,
  lastUpdated: now
}];
fs.writeFileSync(path, JSON.stringify(data, null, 2));
"
echo "  [ok] installed_plugins.json: vync@PresenceWith-Vync v$VERSION"

# 6. Done
echo ""
echo "[vync] Setup complete! Restart Claude Code to activate."
echo ""
echo "  To use 'vync' CLI from any directory, add to your shell profile:"
echo "    export PATH=\"$PROJECT_ROOT/bin:\$PATH\""
