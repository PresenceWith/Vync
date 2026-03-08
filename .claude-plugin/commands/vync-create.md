---
description: Create diagrams in .vync format (mindmap, flowchart, diagram)
allowed-tools: Read, Write, Edit, Bash
argument-hint: <mindmap|flowchart|diagram> <description>
---

Create a .vync diagram based on the user's description.

**You MUST use the vync-editing skill.** Load it now and follow its editing workflow.

## Instructions

1. **Parse arguments**: `$ARGUMENTS` contains `<type> <description>`.
   - Type: `mindmap`, `flowchart`, or `diagram` (free-form).
   - Description: natural language description of what to create.

2. **Find or create target file**: Look for .vync files in the current directory. If none exist, ask the user for a filename, then run `node "$VYNC_HOME/bin/vync.js" init <filename>` first.

3. **Load the appropriate reference** from the vync-editing skill:
   - mindmap → `references/mindmap.md`
   - flowchart → `references/geometry.md` + `references/arrow-line.md`
   - diagram → `references/coordinates.md` + relevant type references

4. **Generate IDs**: Use `node ~/.claude/skills/vync-editing/scripts/generate-id.js <count>` to generate unique 5-char IDs for all elements.

5. **Create the elements** following the skill's templates and references exactly.

6. **Write the .vync file** using the Write tool. If the file already has elements, Read it first and merge your new elements into the existing elements array.

7. **Validation** will run automatically via the PostToolUse hook. If errors are reported, fix them.
