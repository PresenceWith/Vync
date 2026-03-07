# Arrow Line Elements (PlaitArrowLine)

AI editing difficulty: **Medium-Hard** — requires correct `boundId` references and `connection` coordinates.

## Structure

```typescript
interface PlaitArrowLine {
  id: string;
  type: 'arrow-line';
  shape: 'elbow' | 'curve' | 'straight';
  source: ArrowLineHandle;
  target: ArrowLineHandle;
  points: Point[];          // waypoints [start, ..., end]
  texts: ArrowLineText[];   // labels on the line
  opacity: number;          // typically 1
  children: [];             // always empty array
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
}

interface ArrowLineHandle {
  marker: 'none' | 'arrow' | 'open-triangle' | 'filled-triangle';
  boundId?: string;         // ID of connected shape (geometry element)
  connection?: [number, number]; // anchor point on shape (0-1 ratios)
}
```

## Connection Coordinate Map

When binding to a shape (`boundId`), `connection` specifies WHERE on the shape the line connects:

```
        [0.5, 0]
     ┌─────●─────┐
     │            │
[0,0.5]●         ●[1, 0.5]
     │            │
     └─────●─────┘
        [0.5, 1]
```

| Position | Connection | Description |
|----------|-----------|-------------|
| Top center | `[0.5, 0]` | Most common for top-down flows |
| Bottom center | `[0.5, 1]` | Most common for top-down flows |
| Left center | `[0, 0.5]` | Left-right flows |
| Right center | `[1, 0.5]` | Left-right flows |
| Top-left | `[0, 0]` | Corner connections |
| Top-right | `[1, 0]` | Corner connections |
| Bottom-left | `[0, 1]` | Corner connections |
| Bottom-right | `[1, 1]` | Corner connections |

## Marker Types

| Marker | Visual |
|--------|--------|
| `none` | No marker (plain line end) |
| `arrow` | Standard arrowhead (most common) |
| `open-triangle` | Open triangle |
| `filled-triangle` | Filled triangle |

## Points Calculation

For bound arrows, `points` should match the connection positions on the shapes:

```
source shape bottom center → target shape top center
points: [[source_cx, source_y2], [target_cx, target_y1]]
```

Where:
- `source_cx` = source shape center x = `(x1 + x2) / 2`
- `source_y2` = source shape bottom y
- `target_cx` = target shape center x
- `target_y1` = target shape top y

## Complete Example: 2 Shapes + 1 Arrow

```json
[
  {
    "id": "shp01",
    "type": "geometry",
    "shape": "process",
    "points": [[0, 0], [160, 60]],
    "text": { "children": [{ "text": "Step 1" }], "align": "center" },
    "children": []
  },
  {
    "id": "shp02",
    "type": "geometry",
    "shape": "process",
    "points": [[0, 120], [160, 180]],
    "text": { "children": [{ "text": "Step 2" }], "align": "center" },
    "children": []
  },
  {
    "id": "arr01",
    "type": "arrow-line",
    "shape": "elbow",
    "source": {
      "marker": "none",
      "boundId": "shp01",
      "connection": [0.5, 1]
    },
    "target": {
      "marker": "arrow",
      "boundId": "shp02",
      "connection": [0.5, 0]
    },
    "points": [[80, 60], [80, 120]],
    "texts": [],
    "opacity": 1,
    "children": []
  }
]
```

## Adding Text Labels to Lines

```json
"texts": [
  {
    "text": { "children": [{ "text": "Yes" }] },
    "position": 0.5
  }
]
```

`position`: 0 = at source, 0.5 = middle, 1 = at target.

## Common Patterns

### Top-Down Flow (most common)
- Source connection: `[0.5, 1]` (bottom center)
- Target connection: `[0.5, 0]` (top center)

### Left-to-Right Flow
- Source connection: `[1, 0.5]` (right center)
- Target connection: `[0, 0.5]` (left center)

### Decision Diamond (two exits)
- "Yes" exit: `[0.5, 1]` (bottom) → next process `[0.5, 0]` (top)
- "No" exit: `[1, 0.5]` (right) → alternative `[0, 0.5]` (left)

## Important Notes

- **Always create shapes BEFORE arrows** — arrows reference shape IDs via `boundId`
- **Verify `boundId` references** — a typo causes the arrow to be unbound (floating)
- **`elbow` shape is recommended** for flowcharts — the layout engine smooths waypoints
- For unbound arrows (no shape connection), omit `boundId` and `connection`; set `points` to desired start/end positions
