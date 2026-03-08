# Geometry Elements (PlaitGeometry)

AI editing difficulty: **Easy** — uniform structure across all shapes.

## Structure

```typescript
interface PlaitGeometry {
  id: string;                // idCreator(5)
  type: 'geometry';
  shape: GeometryShapes;     // see shape list below
  points: [[x1, y1], [x2, y2]]; // bounding box (top-left, bottom-right)
  text?: ParagraphElement;   // label text
  children: [];              // always empty array
  fill?: string;             // CSS color
  strokeColor?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;          // 0-1
  angle?: number;            // rotation in radians
  autoSize?: boolean;        // text shape only
}
```

## Shape List

### Basic Shapes
| Shape | Description |
|-------|-------------|
| `rectangle` | Rectangle |
| `ellipse` | Ellipse/Circle |
| `diamond` | Diamond/Rhombus |
| `parallelogram` | Parallelogram |
| `roundRectangle` | Rounded rectangle |
| `text` | Text-only (no border) |
| `triangle` | Triangle |
| `cross` | Cross/Plus |
| `cloud` | Cloud shape |
| `star` | Star |
| `pentagon` | Pentagon |
| `hexagon` | Hexagon |
| `octagon` | Octagon |
| `trapezoid` | Trapezoid |
| `leftArrow` | Left arrow |
| `rightArrow` | Right arrow |
| `pentagonArrow` | Pentagon arrow |
| `processArrow` | Process arrow |
| `twoWayArrow` | Bidirectional arrow |
| `comment` | Comment |
| `roundComment` | Round comment |

### Flowchart Symbols
| Shape | Description |
|-------|-------------|
| `process` | Process (rectangle) |
| `decision` | Decision (diamond) |
| `data` | Data (parallelogram) |
| `connector` | Connector |
| `terminal` | Terminal (rounded) |
| `predefinedProcess` | Predefined process |
| `document` | Document |
| `multiDocument` | Multiple documents |
| `manualInput` | Manual input |
| `preparation` | Preparation (hexagon) |
| `storedData` | Stored data |
| `internalStorage` | Internal storage |
| `manualLoop` | Manual loop |
| `delay` | Delay |
| `or` | OR |
| `summingJunction` | Summing junction |
| `display` | Display |
| `offPage` | Off-page connector |
| `merge` | Merge |
| `noteCurlyLeft` | Note (curly left) |
| `noteCurlyRight` | Note (curly right) |
| `noteSquare` | Note (square) |
| `database` | Database |
| `hardDisk` | Hard disk |

## Bounding Box Rules

`points: [[x1, y1], [x2, y2]]`
- `x1 < x2` and `y1 < y2` (top-left must be before bottom-right)
- Width = `x2 - x1`, Height = `y2 - y1`
- Position is absolute on the canvas

## Text Format

```json
{
  "children": [{ "text": "Label" }],
  "align": "center"
}
```

Align options: `"left"`, `"center"`, `"right"`

## Complete Example: 3-Shape Flowchart (without arrows)

```json
[
  {
    "id": "sT1aB",
    "type": "geometry",
    "shape": "terminal",
    "points": [[0, 0], [160, 60]],
    "text": { "children": [{ "text": "Start" }], "align": "center" },
    "children": []
  },
  {
    "id": "pR2cD",
    "type": "geometry",
    "shape": "process",
    "points": [[0, 120], [160, 180]],
    "text": { "children": [{ "text": "Process Data" }], "align": "center" },
    "children": []
  },
  {
    "id": "eN3eF",
    "type": "geometry",
    "shape": "terminal",
    "points": [[0, 240], [160, 300]],
    "text": { "children": [{ "text": "End" }], "align": "center" },
    "children": []
  }
]
```

## Layout Tips

- Standard spacing: 60px vertical gap between shapes
- Typical shape sizes: 160x60 (process), 120x80 (decision), 160x60 (terminal)
- Align shapes horizontally by using the same x1 value
- For grid layout, use consistent x/y intervals (e.g., 200px horizontal, 120px vertical)
- Center text with `"align": "center"` for most shapes
