# Graph Readability Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat module graph with a 3-level drill-down (layers → modules → function type-signature cards) with typed directional arrows on edges.

**Architecture:** Add `viewLevel` state to control which level is rendered. Layer view creates React Flow group nodes from `ProjectAnalysis.layers`. Function nodes redesigned as I/O cards showing parameter types and return type from `FunctionAnalysis`. Edges show `passedType` label from updated `EdgeAnalysis`. All rendering changes are in the renderer — no worker pipeline changes except prompt tweaks.

**Tech Stack:** React Flow (@xyflow/react 12), ELK.js, zustand, existing analysis pipeline

**Design doc:** `docs/plans/2026-04-02-graph-readability-redesign.md`

---

## Task 1: Add `passedType` to EdgeAnalysis and update prompts

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/worker/analysis/prompts.ts`

**Step 1: Add `passedType` to `EdgeAnalysis`**

In `src/shared/types.ts`, add to `EdgeAnalysis`:

```ts
export interface EdgeAnalysis {
  dataFlow: string
  inputType: string
  outputType: string
  transformation: string
  coupling: 'loose' | 'moderate' | 'tight'
  couplingReason: string
  passedType: string  // ← ADD: concrete type on the edge, e.g. "List[Event]"
}
```

**Step 2: Update edge prompt to request `passedType`**

In `src/worker/analysis/prompts.ts`, update `EDGE_SYSTEM` to add:
```
- passedType: the concrete Python type being passed from caller to callee (e.g. "List[Event]", "str", "Config"). Be specific — use the actual type, not a description.
```

Add `passedType` to the JSON output format in `buildEdgePrompt()`.

**Step 3: Update function prompt to require concrete types**

In `FUNCTION_SYSTEM`, change the parameter rule to:
```
- Parameters: use concrete Python types (e.g., "List[Event]", "asyncpg.Pool", "str"), not descriptions. If no annotation, infer from usage.
- returnType: concrete Python type (e.g., "List[MatchGroup]", "None", "float"). Not a description.
```

**Step 4: Commit**

```bash
git add src/shared/types.ts src/worker/analysis/prompts.ts
git commit -m "feat: add passedType to EdgeAnalysis and tighten prompts for concrete types"
```

---

## Task 2: Add view-level state to stores

**Files:**
- Modify: `src/renderer/stores/analysisStore.ts`

**Step 1: Add view-level state**

Add to `AnalysisState`:

```ts
viewLevel: 'layers' | 'modules' | 'functions'
selectedLayer: string | null

setViewLevel: (level: 'layers' | 'modules' | 'functions') => void
selectLayer: (layer: string | null) => void
```

Default: `viewLevel: 'layers'`, `selectedLayer: null`.

When `projectAnalysis` is set, auto-switch to `'layers'` view.

**Step 2: Commit**

```bash
git add src/renderer/stores/analysisStore.ts
git commit -m "feat: add viewLevel and selectedLayer state for 3-level drill-down"
```

---

## Task 3: Create LayerNode component

**Files:**
- Create: `src/renderer/nodes/LayerNode.tsx`
- Modify: `src/renderer/styles.css`

**Step 1: Create LayerNode**

Create `src/renderer/nodes/LayerNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type LayerNodeData = {
  label: string
  color: string
  modules: string[]
  moduleCount: number
  onClick: () => void
}

export function LayerNode({ data }: NodeProps<Node<LayerNodeData>>) {
  return (
    <div
      className="node node-layer"
      style={{ borderColor: data.color, borderLeftColor: data.color, borderLeftWidth: 4 }}
      onClick={data.onClick}
    >
      <Handle type="target" position={Position.Top} />
      <div className="layer-header">
        <span className="layer-color-dot" style={{ backgroundColor: data.color }} />
        <span className="layer-name">{data.label}</span>
      </div>
      <div className="layer-modules">
        {data.modules.map((m) => (
          <div key={m} className="layer-module-item">{m}</div>
        ))}
      </div>
      <div className="layer-count">{data.moduleCount} modules</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

**Step 2: Add CSS**

```css
.node-layer {
  background: #16213e;
  border: 1px solid #333;
  border-radius: 8px;
  padding: 12px 16px;
  min-width: 200px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.node-layer:hover { border-color: #6366f1; }
.layer-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.layer-color-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.layer-name { font-size: 14px; font-weight: 600; }
.layer-modules { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
.layer-module-item { font-size: 11px; opacity: 0.6; padding-left: 20px; }
.layer-count { font-size: 11px; opacity: 0.4; }
```

**Step 3: Commit**

```bash
git add src/renderer/nodes/LayerNode.tsx src/renderer/styles.css
git commit -m "feat: add LayerNode component for layer-level view"
```

---

## Task 4: Redesign FunctionNode as type-signature card

**Files:**
- Modify: `src/renderer/nodes/FunctionNode.tsx`
- Modify: `src/renderer/styles.css`

**Step 1: Rewrite FunctionNode**

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ParameterInfo } from '../../shared/types'

export type FunctionNodeData = {
  label: string
  async?: boolean
  lineCount: number
  summary?: string
  complexity?: 'low' | 'medium' | 'high'
  parameters?: ParameterInfo[]
  returnType?: string
}

export function FunctionNode({ data }: NodeProps<Node<FunctionNodeData>>) {
  return (
    <div className="node node-fn-card">
      <Handle type="target" position={Position.Top} />
      <div className="fn-card-header">
        {data.complexity && (
          <span className={`complexity-dot complexity-${data.complexity}`} />
        )}
        <span className="fn-card-name">
          {data.async && <span className="badge">async</span>}
          {data.label}()
        </span>
        <span className="fn-card-lines">{data.lineCount}L</span>
      </div>
      {data.parameters && data.parameters.length > 0 && (
        <div className="fn-card-section">
          <span className="fn-card-label">IN</span>
          <div className="fn-card-params">
            {data.parameters.map((p) => (
              <div key={p.name} className="fn-card-param">
                <span className="fn-param-name">{p.name}:</span>
                <span className="fn-param-type">{p.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.returnType && (
        <div className="fn-card-section fn-card-out">
          <span className="fn-card-label">OUT</span>
          <span className="fn-param-type">{data.returnType}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

**Step 2: Add CSS for type-signature cards**

```css
.node-fn-card {
  background: #1a1a2e;
  border: 1px solid #3b82f6;
  border-radius: 6px;
  padding: 0;
  min-width: 220px;
  font-size: 12px;
}
.fn-card-header {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid #333;
}
.fn-card-name { font-weight: 600; flex: 1; }
.fn-card-lines { font-size: 10px; opacity: 0.4; }
.fn-card-section {
  padding: 4px 10px;
  border-bottom: 1px solid #2a2a4a;
}
.fn-card-section:last-child { border-bottom: none; }
.fn-card-label {
  font-size: 9px; font-weight: 700; opacity: 0.5;
  text-transform: uppercase; margin-right: 8px;
}
.fn-card-params { display: flex; flex-direction: column; gap: 1px; }
.fn-card-param { display: flex; gap: 4px; padding-left: 28px; }
.fn-param-name { color: #93c5fd; }
.fn-param-type { color: #a78bfa; }
.fn-card-out { display: flex; align-items: center; gap: 4px; }
```

**Step 3: Commit**

```bash
git add src/renderer/nodes/FunctionNode.tsx src/renderer/styles.css
git commit -m "feat: redesign FunctionNode as type-signature card with IN/OUT sections"
```

---

## Task 5: Redesign CallEdge with typed arrows

**Files:**
- Modify: `src/renderer/edges/CallEdge.tsx`
- Modify: `src/renderer/styles.css`

**Step 1: Update CallEdge**

```tsx
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

const COUPLING_COLORS = {
  loose: '#22c55e',
  moderate: '#eab308',
  tight: '#ef4444',
}

export function CallEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath(props)
  const data = props.data as Record<string, unknown> | undefined
  const weight = (data?.weight as number) ?? 1
  const coupling = data?.coupling as string | undefined
  const passedType = data?.passedType as string | undefined

  const strokeWidth = Math.max(2, Math.min(1 + weight, 5))
  const color = coupling && coupling in COUPLING_COLORS
    ? COUPLING_COLORS[coupling as keyof typeof COUPLING_COLORS]
    : '#3b82f6'

  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeWidth }}
        markerEnd="url(#arrow)"
      />
      {passedType && (
        <EdgeLabelRenderer>
          <div
            className="edge-type-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            title={passedType}
          >
            {passedType}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
```

**Step 2: Update CSS**

Replace `.edge-data-flow-label` with `.edge-type-label`:

```css
.edge-type-label {
  font-size: 10px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #a78bfa;
  background: rgba(26, 26, 46, 0.95);
  padding: 2px 6px;
  border-radius: 3px;
  border: 1px solid #333;
  white-space: nowrap;
}
```

**Step 3: Add SVG arrowhead marker to Canvas**

In `Canvas.tsx`, add inside `<ReactFlow>`:

```tsx
<svg style={{ position: 'absolute', width: 0, height: 0 }}>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
      markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
    </marker>
  </defs>
</svg>
```

**Step 4: Commit**

```bash
git add src/renderer/edges/CallEdge.tsx src/renderer/Canvas.tsx src/renderer/styles.css
git commit -m "feat: redesign CallEdge with typed arrows and coupling colors"
```

---

## Task 6: Implement 3-level Canvas rendering

**Files:**
- Modify: `src/renderer/Canvas.tsx`

**Step 1: Add `layersToFlow()` function**

New function that converts `ProjectAnalysis.layers` into React Flow nodes and edges:

```ts
function layersToFlow(
  project: ProjectAnalysis,
  graph: GraphData,
  onLayerClick: (layer: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = project.layers.map((layer) => ({
    id: `layer:${layer.name}`,
    type: 'layer',
    position: { x: 0, y: 0 },
    data: {
      label: layer.name,
      color: layer.color,
      modules: layer.modules,
      moduleCount: layer.modules.length,
      onClick: () => onLayerClick(layer.name),
    },
  }))

  // Create edges between layers based on cross-layer module edges
  const moduleToLayer = new Map<string, string>()
  for (const layer of project.layers) {
    for (const mod of layer.modules) {
      moduleToLayer.set(mod, layer.name)
    }
  }

  const layerEdgeCounts = new Map<string, number>()
  for (const e of graph.edges) {
    const srcLayer = moduleToLayer.get(e.source)
    const tgtLayer = moduleToLayer.get(e.target)
    if (srcLayer && tgtLayer && srcLayer !== tgtLayer) {
      const key = `${srcLayer}|${tgtLayer}`
      layerEdgeCounts.set(key, (layerEdgeCounts.get(key) ?? 0) + 1)
    }
  }

  const edges: Edge[] = []
  let edgeIdx = 0
  for (const [key, count] of layerEdgeCounts) {
    const [src, tgt] = key.split('|')
    edges.push({
      id: `layer-edge-${edgeIdx++}`,
      source: `layer:${src}`,
      target: `layer:${tgt}`,
      type: 'call',
      data: { weight: count },
    })
  }

  return { nodes, edges }
}
```

**Step 2: Update Canvas to switch between view levels**

Read `viewLevel` and `selectedLayer` from `analysisStore`. Render different content:

- `viewLevel === 'layers'`: call `layersToFlow()` 
- `viewLevel === 'modules'` or `viewLevel === 'functions'`: call existing `graphToFlow()` (optionally filter to selected layer's modules)

Register `LayerNode` in `nodeTypes`.

**Step 3: Add breadcrumb navigation**

Above the canvas, show a breadcrumb: `Layers > [LayerName] > [ModuleName]`. Clicking a breadcrumb level navigates back.

**Step 4: Commit**

```bash
git add src/renderer/Canvas.tsx
git commit -m "feat: implement 3-level drill-down (layers → modules → functions)"
```

---

## Task 7: Pass analysis data to function nodes

**Files:**
- Modify: `src/renderer/Canvas.tsx` (in `graphToFlow()`)

**Step 1: Pass parameters and returnType to function node data**

In `graphToFlow()`, when building function nodes, include analysis data:

```ts
data: {
  label: n.label,
  async: n.metadata.async,
  lineCount: n.lineRange[1] - n.lineRange[0] + 1,
  summary: analysis?.summary,
  complexity: analysis?.complexity,
  parameters: analysis?.parameters,   // ← ADD
  returnType: analysis?.returnType,    // ← ADD
}
```

**Step 2: Pass `passedType` to edges**

In the edge loop, include `passedType` from `EdgeAnalysis`:

```ts
data: {
  weight: e.weight,
  passedType: edgeAn?.passedType,  // ← ADD (replaces dataFlow)
  coupling: edgeAn?.coupling,
}
```

**Step 3: Commit**

```bash
git add src/renderer/Canvas.tsx
git commit -m "feat: pass type signatures and passedType to nodes and edges"
```

---

## Task 8: Build, run analysis, and take Playwright snapshots

**Files:**
- Modify: `test/e2e/snapshots.test.ts`

**Step 1: Rebuild production package**

```bash
npx electron-forge package
```

**Step 2: Run analysis via Playwright**

Launch app, open predex-pairing, select Opus, click Analyze, wait for completion.

**Step 3: Take snapshots at each level**

- Layer overview (after analysis completes)
- Module view (after clicking a layer)
- Function type cards (after expanding a module)
- Edge with typed arrow label

**Step 4: Commit snapshots**

```bash
git add test/snapshots/ test/e2e/snapshots.test.ts
git commit -m "test: add snapshots for 3-level drill-down with type signatures"
```

---

## Summary

| Task | What it builds |
|------|---------------|
| 1 | Add `passedType` to EdgeAnalysis, tighten prompts for concrete types |
| 2 | Add `viewLevel`/`selectedLayer` state |
| 3 | LayerNode component |
| 4 | Redesigned FunctionNode as type-signature card |
| 5 | Redesigned CallEdge with typed arrows and arrowheads |
| 6 | 3-level Canvas rendering with breadcrumb |
| 7 | Wire analysis data (params, returnType, passedType) to nodes/edges |
| 8 | Build, analyze, Playwright verification snapshots |
