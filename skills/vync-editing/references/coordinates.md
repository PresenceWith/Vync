# Coordinate System & Layout

## Point Type

`Point = [number, number]` — `[x, y]` tuple.

- Positive x = right
- Positive y = down
- Origin `[0, 0]` = canvas center (approximately)

## Element Positioning

### Geometry / Image (Bounding Box)
```
points: [[x1, y1], [x2, y2]]
```
- `[x1, y1]` = top-left corner
- `[x2, y2]` = bottom-right corner
- Rules: `x1 < x2`, `y1 < y2`
- Width = `x2 - x1`, Height = `y2 - y1`

### Mindmap Root (Single Point)
```
points: [[x, y]]
```
- Single position point for the root node
- Child nodes are auto-positioned by the layout engine
- Multiple mindmaps: use different root positions (e.g., `[[0, 0]]`, `[[500, 0]]`)

### Arrow Line (Waypoints)
```
points: [start, ...waypoints, end]
```
- When bound to shapes, should match connection points on source/target shapes

## Viewport

```json
"viewport": { "zoom": 1, "x": 0, "y": 0 }
```

- `zoom`: zoom level (> 0, typically 0.25–4.0, default 1)
- `x`, `y`: viewport pan offset
- Do NOT modify viewport unless explicitly asked

## Layout Strategies

### Vertical Flow (Flowcharts)

Place shapes in a column with consistent spacing:
```
Shape 1: points [[cx-w/2, y], [cx+w/2, y+h]]
Shape 2: points [[cx-w/2, y+h+gap], [cx+w/2, y+2h+gap]]
Shape 3: points [[cx-w/2, y+2(h+gap)], [cx+w/2, y+3h+2*gap]]
```

Recommended values:
- Width (`w`): 160
- Height (`h`): 60
- Gap: 60
- Center x (`cx`): 80

### Horizontal Flow

Place shapes in a row:
```
Shape 1: points [[x, cy-h/2], [x+w, cy+h/2]]
Shape 2: points [[x+w+gap, cy-h/2], [x+2w+gap, cy+h/2]]
```

### Grid Layout (Multiple Shapes)

For N shapes in a grid:
```
col = index % columns
row = Math.floor(index / columns)
x1 = col * (width + gapX)
y1 = row * (height + gapY)
```

Recommended:
- Columns: 3–4
- gapX: 40–60
- gapY: 40–60

### Decision Branch (Diamond with Two Paths)

```
            [Decision]
           /          \
    [Yes path]    [No path]
         |
    [Continue]
```

Layout:
- Decision: `[[cx-60, y], [cx+60, y+80]]`
- Yes (below): `[[cx-80, y+140], [cx+80, y+200]]`
- No (right): `[[cx+120, y+20], [cx+280, y+80]]`

## Avoiding Overlap

When placing multiple elements:
1. Track used regions (bounding boxes)
2. Ensure minimum gap between shapes (20-40px)
3. For flowcharts, maintain consistent column alignment
4. For mindmaps, space root nodes at least 400px apart

## Size Guidelines

| Element Type | Typical Width | Typical Height |
|-------------|--------------|----------------|
| Process box | 140–200 | 50–70 |
| Decision diamond | 100–140 | 70–100 |
| Terminal | 120–160 | 40–60 |
| Text label | auto (autoSize) | auto |
| Mindmap root | 80–120 | 40–50 |
