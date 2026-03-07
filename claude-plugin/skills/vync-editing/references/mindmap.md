# Mindmap Elements (PlaitMind / MindElement)

AI editing difficulty: **Easy** — tree structure is intuitive, only topic text + children hierarchy needed.

## Structure

### Root Node (PlaitMind)

```typescript
interface PlaitMind {
  id: string;              // idCreator(5)
  type: 'mindmap';         // root node type
  points: [[x, y]];        // single point — root position
  data: {
    topic: ParagraphElement; // { children: [{ text: "..." }] }
  };
  children: MindElement[];  // child nodes (tree)
  width: number;            // root node width (e.g., 100)
  height: number;           // root node height (e.g., 50)
  isRoot: true;
  rightNodeCount?: number;  // children on right side (standard layout)
}
```

### Child Node (MindElement)

```typescript
interface MindElement {
  id: string;
  type: 'mind_child';
  data: {
    topic: ParagraphElement;
  };
  children: MindElement[];  // nested children (recursive)
  // NO points needed — layout engine auto-places children
}
```

## Key Fields

| Field | Required | Notes |
|-------|----------|-------|
| `id` | Yes | 5-char unique ID |
| `type` | Yes | `'mindmap'` (root) or `'mind_child'` (children) |
| `data.topic` | Yes | Slate text: `{ "children": [{ "text": "..." }] }` |
| `children` | Yes | `MindElement[]`, can be `[]` for leaf nodes |
| `points` | Root only | `[[x, y]]` single point for root position |
| `width` / `height` | Root only | Dimensions (e.g., 100, 50) |
| `isRoot` | Root only | Must be `true` |
| `rightNodeCount` | Optional | How many children go to the right side |

## Optional Styling Fields

| Field | Values | Default |
|-------|--------|---------|
| `shape` | `'round-rectangle'`, `'underline'` | `'round-rectangle'` |
| `fill` | CSS color string | theme default |
| `strokeColor` | CSS color string | theme default |
| `strokeWidth` | number | 2 |
| `branchColor` | CSS color string | auto |
| `branchWidth` | number | 2 |
| `branchShape` | `'bight'`, `'polyline'` | `'bight'` |
| `layout` | `'right'`, `'left'`, `'standard'`, `'downward'`, `'upward'`, `'rightBottomIndented'`, `'leftBottomIndented'` | `'standard'` |
| `isCollapsed` | boolean | false |

## Text Format (ParagraphElement)

Simple text:
```json
{ "children": [{ "text": "Node text" }] }
```

Formatted text:
```json
{
  "children": [
    { "text": "Bold ", "bold": true },
    { "text": "normal" }
  ]
}
```

**Critical**: `children` array must never be empty. Minimum: `[{ "text": "" }]`

## Complete Example: 3-Level Mindmap

```json
{
  "id": "AbCdE",
  "type": "mindmap",
  "data": { "topic": { "children": [{ "text": "Project Plan" }] } },
  "children": [
    {
      "id": "FgHjK",
      "type": "mind_child",
      "data": { "topic": { "children": [{ "text": "Design" }] } },
      "children": [
        {
          "id": "MnPqR",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Architecture" }] } },
          "children": []
        },
        {
          "id": "StWxY",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Data Model" }] } },
          "children": []
        }
      ]
    },
    {
      "id": "aBcDe",
      "type": "mind_child",
      "data": { "topic": { "children": [{ "text": "Implementation" }] } },
      "children": [
        {
          "id": "fGhJk",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Backend" }] } },
          "children": []
        },
        {
          "id": "mNpQr",
          "type": "mind_child",
          "data": { "topic": { "children": [{ "text": "Frontend" }] } },
          "children": []
        }
      ]
    }
  ],
  "width": 100,
  "height": 50,
  "points": [[0, 0]],
  "isRoot": true
}
```

## Tips

- Start with root `points: [[0, 0]]` — centered on canvas
- Child nodes need NO positional data — the layout engine handles placement
- `rightNodeCount` controls left/right distribution in `standard` layout. If omitted, children split evenly.
- Multiple mindmaps can coexist in one file — just add multiple root elements to the `elements` array with different positions (e.g., `[[0, 0]]` and `[[500, 0]]`)
