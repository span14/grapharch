# UI Polish — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the graph visually consistent, readable, and professional — fix node inconsistencies, edge visibility, selection states, and panel readability.

**Architecture:** Pure CSS + React component changes. No worker, IPC, or data model changes. All modifications are in `src/renderer/`.

**Tech Stack:** React, @xyflow/react 12, CSS

---

## Task 1: Unified node base styles + selection state

**Files:**
- Modify: `src/renderer/styles.css`
- Modify: `src/renderer/Canvas.tsx` (pass `selected` to node data)

**Step 1: Rewrite the base `.node` styles and add `.node-selected`**

Replace the entire `/* --- Nodes --- */` section in `styles.css` with a unified system:

```css
/* --- Nodes --- */

.node {
  padding: 10px 14px;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid #2a3a5c;
  min-width: 140px;
  color: #e0e0e0;
  background: #16213e;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.node-selected {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
}

.node-module { border-color: #0f3460; }
.node-module.expanded { min-height: 200px; }

.node-class { background: #1a1e3f; border-color: #7c3aed; }
.node-method { background: #1e2247; border-color: #6366f1; font-size: 11px; padding: 6px 10px; }
```

Keep the `.node-fn-card` styles as-is but add selection:
```css
.node-fn-card.node-selected {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.3);
}
```

**Step 2: Pass `selected` boolean to node data in Canvas.tsx**

In `graphToFlow()`, for every node push, add:
```ts
data: {
  ...existingData,
  selected: n.id === selectedNodeId,
}
```

This requires passing `selectedNodeId` into `graphToFlow`. Add it as a parameter.

**Step 3: Apply `node-selected` class in each node component**

In each node component (ModuleNode, FunctionNode, ClassNode, MethodNode, LayerNode), add the class conditionally:

```tsx
// ModuleNode example:
<div className={`node node-module ${data.expanded ? 'expanded' : ''} ${data.selected ? 'node-selected' : ''}`}>
```

Add `selected?: boolean` to each node's data type.

**Step 4: Commit**
```bash
git commit -m "feat: unified node styles with selection glow"
```

---

## Task 2: Fix edge visibility + import arrows

**Files:**
- Modify: `src/renderer/edges/ImportEdge.tsx`
- Modify: `src/renderer/edges/CallEdge.tsx`
- Modify: `src/renderer/Canvas.tsx` (add import arrow marker)

**Step 1: Redesign ImportEdge with arrow and better color**

```tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function ImportEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  const data = props.data as Record<string, unknown> | undefined
  const isUnresolved = data?.kind === 'import_unresolved'

  return (
    <BaseEdge
      path={path}
      style={{
        stroke: isUnresolved ? '#ef4444' : '#64748b',
        strokeWidth: 2,
        strokeDasharray: '6,4',
      }}
      markerEnd={isUnresolved ? 'url(#arrow-red)' : 'url(#arrow-gray)'}
    />
  )
}
```

**Step 2: Add additional arrow markers in Canvas.tsx**

Extend the SVG defs to include gray and red markers:

```tsx
<svg style={{ position: 'absolute', width: 0, height: 0 }}>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
    </marker>
    <marker id="arrow-gray" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
    </marker>
    <marker id="arrow-red" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
    </marker>
    <marker id="arrow-green" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
    </marker>
    <marker id="arrow-yellow" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" />
    </marker>
  </defs>
</svg>
```

**Step 3: Update CallEdge to use coupling-colored arrow markers**

In CallEdge.tsx, change the `markerEnd` to match the coupling color:

```tsx
const COUPLING_MARKERS: Record<string, string> = {
  loose: 'url(#arrow-green)',
  moderate: 'url(#arrow-yellow)',
  tight: 'url(#arrow-red)',
}

// In the return:
markerEnd={coupling && coupling in COUPLING_MARKERS ? COUPLING_MARKERS[coupling] : 'url(#arrow)'}
```

**Step 4: Pass edge kind to ImportEdge data**

In Canvas.tsx `graphToFlow()`, include the edge kind in data:
```ts
data: { weight: e.weight, passedType: edgeAn?.passedType, coupling: edgeAn?.coupling, kind: e.kind },
```

**Step 5: Commit**
```bash
git commit -m "feat: visible edges with colored arrows and unresolved import distinction"
```

---

## Task 3: Detail panel readability

**Files:**
- Modify: `src/renderer/panels/DetailPanel.tsx`
- Modify: `src/renderer/styles.css`

**Step 1: Add section dividers and complexity pill**

In DetailPanel.tsx, change the complexity display from plain text to a colored pill:
```tsx
<span className={`detail-complexity-pill complexity-bg-${fnAnalysis.complexity}`}>
  {fnAnalysis.complexity}
</span>
```

**Step 2: Improve code preview styling**

Update `.detail-code` in styles.css:
```css
.detail-code {
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', Menlo, monospace;
  background: #0f172a;
  padding: 12px;
  border-radius: 6px;
  overflow-x: auto;
  max-height: 240px;
  line-height: 1.5;
  white-space: pre;
  border: 1px solid #1e293b;
  color: #cbd5e1;
}
```

**Step 3: Add complexity pill and section divider CSS**

```css
.detail-complexity-pill {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  padding: 2px 8px; border-radius: 10px; letter-spacing: 0.5px;
}
.complexity-bg-low { background: rgba(34,197,94,0.15); color: #22c55e; }
.complexity-bg-medium { background: rgba(234,179,8,0.15); color: #eab308; }
.complexity-bg-high { background: rgba(239,68,68,0.15); color: #ef4444; }

.detail-section { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid #1e293b; }
.detail-section:last-child { border-bottom: none; padding-bottom: 0; }
```

**Step 4: Commit**
```bash
git commit -m "feat: improved detail panel with complexity pills and code styling"
```

---

## Task 4: Breadcrumb, minimap, and filter bar polish

**Files:**
- Modify: `src/renderer/styles.css`

**Step 1: Polish breadcrumb**

```css
.breadcrumb {
  height: 36px; background: #0f172a; border-bottom: 1px solid #1e293b;
  display: flex; align-items: center; padding: 0 16px; gap: 2px;
}
.breadcrumb-btn {
  background: none; border: none; color: #64748b; cursor: pointer;
  font-size: 12px; padding: 4px 8px; border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.breadcrumb-btn:hover { background: #1e293b; color: #e2e8f0; }
.breadcrumb-btn:last-child { color: #e2e8f0; font-weight: 600; }
.breadcrumb-sep { color: #334155; margin: 0 2px; font-size: 10px; }
```

**Step 2: Custom minimap colors**

```css
.react-flow__minimap {
  background-color: #0f172a;
  border: 1px solid #1e293b;
  border-radius: 6px;
}
.react-flow__minimap-mask { fill: rgba(96, 165, 250, 0.08); }
.react-flow__minimap-node { fill: #334155; stroke: none; }
```

**Step 3: Polish filter bar**

```css
.filter-bar {
  height: 42px; background: #0f172a; border-bottom: 1px solid #1e293b;
  display: flex; align-items: center; padding: 0 16px; gap: 16px;
}
.search-input {
  background: #1e293b; border: 1px solid #334155; color: #e2e8f0;
  padding: 6px 12px; border-radius: 6px; font-size: 13px; width: 220px;
  transition: border-color 0.15s;
}
.search-input:focus { border-color: #3b82f6; outline: none; }
.search-input::placeholder { color: #475569; }
```

**Step 4: Commit**
```bash
git commit -m "feat: polished breadcrumb, minimap, and filter bar"
```

---

## Task 5: Build, verify with Playwright snapshots

**Files:**
- Run: `npx electron-forge package`
- Run: Playwright snapshot script

**Step 1: Rebuild**

```bash
npx electron-forge package
```

**Step 2: Take snapshots at each view level**

Launch via Playwright, open predex-pairing, run analysis (or use cached), capture:
- Layer overview
- Module drill-down
- Function type cards (expanded module)
- Detail panel with node selected

**Step 3: Commit snapshots**
```bash
git commit -m "test: UI polish verification snapshots"
```

---

## Summary

| Task | What it does |
|------|-------------|
| 1 | Unified node padding/border/radius, selection glow |
| 2 | Import edge arrows, unresolved=red, coupling-colored markers |
| 3 | Detail panel: complexity pills, code preview styling, section dividers |
| 4 | Breadcrumb, minimap, filter bar visual polish |
| 5 | Build + Playwright verification |
