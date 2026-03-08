---
description: Vync server and file management (init, open, stop, read)
allowed-tools: Bash, Read
argument-hint: <init|open|stop|read> [file]
---

Run the Vync CLI command: `vync $ARGUMENTS`

## Subcommands

- `init <file>` — Create an empty .vync canvas file. Appends .vync extension if missing.
- `open <file>` — Start the Vync server (port 3100) as a background daemon and open browser. Returns immediately. Use `--foreground` to run in blocking mode.
- `stop` — Stop the running Vync server.
- `read <file>` — Read a .vync file and summarize its contents.

## Execution

For `init`, `open`, `stop`: run via Bash:
```bash
node "$VYNC_HOME/bin/vync.js" $ARGUMENTS
```

For `read`: use the Read tool to read the .vync file, then present a structured summary:
- Total element count
- Element tree (for mindmaps: indented hierarchy with topic text)
- For geometries: shape type + label + position
- For arrow-lines: source → target connections
