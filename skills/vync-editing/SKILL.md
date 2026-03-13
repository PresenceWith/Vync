---
name: vync-editing
description: Edit .vync canvas files (PlaitElement JSON). Use when creating or modifying mindmaps, flowcharts, diagrams in .vync format. Triggers on .vync file editing, mindmap/diagram creation, PlaitElement manipulation, Plait/Vync canvas operations.
---

# Vync Canvas Editing

## .vync File Format

```json
{
  "version": 1,
  "viewport": { "zoom": 1, "x": 0, "y": 0 },
  "elements": [ /* PlaitElement[] */ ]
}
```

## ID Generation Rule

`idCreator(5)` — 5-char random string from: `ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz`
All IDs must be unique across the entire file (including nested children).
Generate with: `node "$VYNC_HOME/skills/vync-editing/scripts/generate-id.js" [count]`

## Editing Workflow

1. **Read** the target .vync file first
2. **Load** the relevant reference for your element type:
   - Mindmap: `references/mindmap.md`
   - Geometry (shapes): `references/geometry.md`
   - Arrow lines: `references/arrow-line.md`
   - Coordinate system: `references/coordinates.md`
3. **Generate IDs** using `node "$VYNC_HOME/skills/vync-editing/scripts/generate-id.js" <count>`
4. **Create** valid PlaitElement[] JSON following the reference
5. **Write** to file — PostToolUse hook will auto-validate

## Critical Rules

- `children` arrays in Slate text nodes must never be empty — minimum: `[{ "text": "" }]`
- Mindmap child nodes do NOT need `points` — layout engine auto-places them
- Bounding box points: `[[x1,y1], [x2,y2]]` where x1 < x2, y1 < y2
- When modifying existing files, preserve all fields you don't intend to change
- Do NOT modify `viewport` unless explicitly asked

## Element Types

| Type | Difficulty | Primary Use |
|------|-----------|-------------|
| `mindmap` / `mind_child` | Easy | Planning, brainstorming |
| `geometry` | Easy | Flowcharts, diagrams |
| `arrow-line` | Medium-Hard | Connecting shapes (boundId binding) |
| `vector-line` | Easy | Free-form lines |
| `image` | Hard (avoid) | Use web UI instead |

## Quick Templates

### Minimal Mindmap (most common)
```json
{
  "id": "<5-char>", "type": "mindmap",
  "data": { "topic": { "children": [{ "text": "Root Topic" }] } },
  "children": [
    {
      "id": "<5-char>", "type": "mind_child",
      "data": { "topic": { "children": [{ "text": "Child 1" }] } },
      "children": []
    }
  ],
  "width": 100, "height": 50, "points": [[0, 0]], "isRoot": true
}
```

### Minimal Rectangle
```json
{
  "id": "<5-char>", "type": "geometry", "shape": "rectangle",
  "points": [[0, 0], [200, 80]],
  "text": { "children": [{ "text": "Label" }] },
  "children": []
}
```

## Validation

Files are auto-validated by PostToolUse hook on Write/Edit.
Manual check: `node "$VYNC_HOME/skills/vync-editing/scripts/validate.js" <file.vync>`

## Example Files

- `$VYNC_HOME/skills/vync-editing/assets/mindmap.vync` — 3-level mindmap
- `$VYNC_HOME/skills/vync-editing/assets/flowchart.vync` — 3 shapes + 2 arrows
