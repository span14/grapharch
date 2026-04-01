# Phase 1 — Static Graph Viewer

> Electron desktop app that parses a Python project and renders an interactive
> architecture graph with module-level and function-level views.

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| App type | Electron desktop app | Native folder picker, file watcher, rich UI |
| Scaffolding | Electron Forge + React + Vite | Battle-tested, tree-sitter Node bindings work out of the box |
| Target language | Python only | Ship on predex-pairing first, generalize later |
| Granularity | Layered (module → functions) | Module-level default, expand to drill into internals |
| Process model | Utility process for parser | Keeps UI responsive during heavy parses |
| Layout engine | ELK.js (layered DAG) | Best automatic layout for directed dependency graphs |
| Graph rendering | React Flow (@xyflow/react v12) | Interactive nodes/edges, subflows, custom components |
| Persistence | Cached graph JSON in ~/.grapharc/cache/ | Instant startup, layout overrides preserved |
| Input model | Open a project directory | Walk recursively, respect .gitignore + default ignores |
| State management | Zustand | Lightweight, works well with React Flow |
| Testing | Vitest + fixture Python project | Fast, TypeScript-native |

---

## Process Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron App                          │
│                                                          │
│  ┌──────────────┐     ┌──────────────────────────────┐  │
│  │ Main Process  │     │ Renderer Process              │  │
│  │               │     │                              │  │
│  │  Window mgmt  │ IPC │  React Flow canvas           │  │
│  │  Menu/tray    │◄───►│  ELK layout engine           │  │
│  │  IPC router   │     │  Node/edge components        │  │
│  │  App lifecycle │     │  Filter/search panels        │  │
│  └──────┬───────┘     └──────────────────────────────┘  │
│         │                                                │
│         │ MessagePort                                    │
│         │                                                │
│  ┌──────▼───────┐                                       │
│  │ Utility       │                                       │
│  │ Process       │                                       │
│  │               │                                       │
│  │  tree-sitter  │                                       │
│  │  parser       │                                       │
│  │  symbol       │                                       │
│  │  extractor    │                                       │
│  │  edge         │                                       │
│  │  resolver     │                                       │
│  │  file watcher │                                       │
│  │  graph cache  │                                       │
│  └──────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

**Main process** — thin router. Manages windows, menus, lifecycle. Forwards
messages between renderer and utility process.

**Utility process** — `utilityProcess.fork()` runs the parser. Owns tree-sitter,
file watching, graph building, and the JSON cache on disk. Sends `GraphData`
to renderer via IPC when parse completes or files change.

**Renderer process** — all UI. Receives `GraphData`, runs ELK layout, renders
React Flow. Sends user actions (expand module, filter, search) back.

---

## Parser Pipeline

The utility process runs a 4-stage pipeline:

```
project directory → file discovery → AST → symbols → edges → GraphData
```

### Stage 1: File Discovery

Walks the target directory recursively. Respects `.gitignore` patterns (if
present) and default ignores: `.venv`, `__pycache__`, `.git`, `node_modules`,
`.tox`, `.eggs`. Returns list of `.py` files.

### Stage 2: AST Parsing (tree-sitter)

Each `.py` file parsed via tree-sitter-python. Extracts:

| Symbol Kind | tree-sitter Node Types | Example |
|-------------|----------------------|---------|
| `module` | root node | `db.py` |
| `function` | `function_definition` | `load_events` |
| `class` | `class_definition` | `Config` |
| `method` | `function_definition` inside `class_definition` | `Event.from_row` |

Each symbol becomes a `Node` with `id`, `kind`, `label`, `filePath`, `lineRange`.

### Stage 3: Edge Resolution

Two passes:

**Pass 1 — Imports.** Parse `import` and `from...import` statements. Resolve to
actual file paths using Python's module resolution rules (relative imports,
`src/` layout, `__init__.py`).

```python
from pairing.db import load_events
# → Edge: { source: "matching_v3.py", target: "db.py::load_events", kind: "import" }
```

**Pass 2 — Calls.** Walk function bodies for call expressions. Match against
known symbols from Stage 2. Only resolve calls to symbols within the project
(ignore stdlib/third-party).

```python
events = await db.load_events(platform)
# → Edge: { source: "matching_v3.py::bootstrap", target: "db.py::load_events", kind: "call" }
```

### Stage 4: Graph Assembly

Combine all nodes + edges into `GraphData`. Compute module-level rollup:
if function A in module X calls function B in module Y, create a module-level
edge `X → Y` with `weight` = number of cross-module calls.

### Incremental Re-parse

File watcher detects change → re-parse only that file → re-run edge resolution
for affected files → diff against cached graph → send `GraphDiff` (not full
graph) to renderer.

---

## Data Models

### Graph Data (shared/types.ts)

```typescript
interface GraphData {
  nodes: Node[]
  edges: Edge[]
  metadata: RepoMetadata
}

interface RepoMetadata {
  rootDir: string
  fileCount: number
  parsedAt: string  // ISO timestamp
}

interface Node {
  id: string                          // "src/pairing/db.py::load_events"
  kind: "module" | "class" | "function" | "method"
  label: string                       // "load_events"
  filePath: string                    // "src/pairing/db.py"
  lineRange: [number, number]         // [146, 187]
  parent?: string                     // module or class this belongs to
  childCount?: number                 // number of functions/classes inside (for modules)
  metadata: Record<string, unknown>   // async, decorator, etc.
}

interface Edge {
  id: string
  source: string
  target: string
  kind: "import" | "call" | "import_unresolved"
  weight?: number                     // for module-level rollups
}

interface GraphDiff {
  nodesAdded: Node[]
  nodesRemoved: string[]
  nodesModified: { id: string; changes: Partial<Node> }[]
  edgesAdded: Edge[]
  edgesRemoved: string[]
}
```

### IPC Messages (shared/ipcChannels.ts)

Utility → Renderer:

| Channel | Payload | When |
|---------|---------|------|
| `graph:ready` | `GraphData` | Initial parse complete |
| `graph:diff` | `GraphDiff` | File changed, incremental update |
| `parse:progress` | `{ total, done }` | During initial parse |
| `parse:error` | `{ file, error }` | Parse failure on a file |

Renderer → Utility:

| Channel | Payload | When |
|---------|---------|------|
| `project:open` | `{ rootDir }` | User opens a project directory |
| `project:refresh` | — | User triggers full re-parse |

---

## Renderer & UI

### Layout

ELK.js computes positions. Two layout modes:

| Mode | When | Algorithm |
|------|------|-----------|
| Module-level | Default view | `elk-layered` (top-to-bottom DAG) |
| Expanded module | User double-clicks a module | Children laid out inside parent bounds |

Layout computed once per graph change, then cached. User-dragged node positions
are preserved across re-parses (stored by node ID in `layout-overrides.json`).

### Node Components

| Kind | Shape | Shows |
|------|-------|-------|
| `module` | Rounded rectangle, dark bg | File name, function count, expand/collapse toggle |
| `function` | Pill, lighter bg | Name, line count, `async` badge if applicable |
| `class` | Rectangle with header bar | Class name, method count, expandable |
| `method` | Small pill inside class | Name only |

Collapsed module: `db.py (12 functions)`.
Expanded module: all child functions/classes as sub-nodes inside the module boundary
(React Flow `parentId`).

### Edge Rendering

| Kind | Style | Label |
|------|-------|-------|
| `import` | Dashed, gray | — |
| `call` | Solid, blue | — |
| `call` (high weight) | Solid, thicker, orange | Call count |
| `import_unresolved` | Dashed, red | — |

Module-level edges aggregate: if 5 functions in module A call functions in
module B, the module edge shows `weight: 5` with proportional thickness.

### Panels

| Panel | Position | Contents |
|-------|----------|----------|
| Detail | Right sidebar | Selected node: file path, line range, source preview (first 20 lines), incoming/outgoing edges |
| Filter | Top bar | Search by name, filter by kind, toggle edge types on/off |
| Minimap | Bottom-right | React Flow built-in minimap |

### Interactions

| Action | Result |
|--------|--------|
| Click module | Select, show detail panel |
| Double-click module | Expand/collapse internal functions |
| Click function | Select, show source preview in detail panel |
| Scroll | Zoom |
| Drag canvas | Pan |
| Drag node | Move, persist position override |
| Cmd+F | Focus search |

---

## Caching & Startup

### Startup Sequence

1. App launches
2. Main process creates window + spawns utility process
3. Utility process checks for cached graph:
   - Cache exists + files unchanged → send cached GraphData (instant)
   - Cache exists + some files changed → incremental re-parse, send diff
   - No cache → full parse, send GraphData, write cache
4. Renderer receives GraphData → ELK layout → render

### Cache Location

```
~/.grapharc/cache/<project-hash>/
├── graph.json              # Full GraphData snapshot
├── file-hashes.json        # { "src/pairing/db.py": "sha256:..." }
└── layout-overrides.json   # User-dragged node positions { nodeId: {x, y} }
```

`project-hash` = `sha256(absolutePath)` of the root directory.

### Error Handling

| Failure | Behavior |
|---------|----------|
| tree-sitter parse failure on a file | Skip file, log warning, parse the rest |
| Unresolvable import | Edge with `kind: "import_unresolved"`, rendered as red dashed line |
| File watcher error | Fall back to manual refresh |
| Cache corrupt | Delete cache, full re-parse |

---

## Directory Structure

```
grapharc/
├── package.json
├── forge.config.ts              # Electron Forge config
├── tsconfig.json
├── vite.main.config.ts          # Vite config for main process
├── vite.renderer.config.ts      # Vite config for renderer
│
├── src/
│   ├── main/
│   │   ├── index.ts             # Main process entry — window, menu, IPC routing
│   │   ├── ipc.ts               # IPC channel definitions and handlers
│   │   └── menu.ts              # Native menu (File > Open Project Folder…)
│   │
│   ├── worker/
│   │   ├── index.ts             # Utility process entry
│   │   ├── discovery.ts         # Walk directory, apply ignore rules
│   │   ├── parser.ts            # tree-sitter Python AST parsing
│   │   ├── symbols.ts           # AST → Node extraction
│   │   ├── edges.ts             # Import + call resolution
│   │   ├── graph.ts             # Assemble GraphData, compute module rollups
│   │   ├── watcher.ts           # Recursive file watcher, change detection
│   │   └── cache.ts             # Read/write graph cache to disk
│   │
│   ├── renderer/
│   │   ├── index.html
│   │   ├── App.tsx              # Root — layout + panels + canvas
│   │   ├── Canvas.tsx           # React Flow container
│   │   ├── layout.ts            # ELK.js wrapper
│   │   ├── nodes/
│   │   │   ├── ModuleNode.tsx   # Collapsible module node
│   │   │   ├── FunctionNode.tsx # Function pill node
│   │   │   ├── ClassNode.tsx    # Class with header
│   │   │   └── MethodNode.tsx   # Method inside class
│   │   ├── edges/
│   │   │   ├── ImportEdge.tsx   # Dashed gray
│   │   │   └── CallEdge.tsx     # Solid blue, weight-scaled
│   │   ├── panels/
│   │   │   ├── DetailPanel.tsx  # Right sidebar
│   │   │   └── FilterBar.tsx    # Top bar
│   │   ├── hooks/
│   │   │   ├── useGraph.ts      # Receive GraphData/GraphDiff via IPC
│   │   │   ├── useLayout.ts     # ELK layout computation + caching
│   │   │   └── useSelection.ts  # Track selected node/edge
│   │   └── stores/
│   │       └── graphStore.ts    # Zustand store for graph state
│   │
│   └── shared/
│       ├── types.ts             # GraphData, Node, Edge, GraphDiff
│       ├── ipcChannels.ts       # Channel name constants
│       └── constants.ts         # Default ignores, config defaults
│
├── resources/
│   └── icon.png                 # App icon
│
└── test/
    ├── worker/
    │   ├── parser.test.ts       # Parse a known .py file, verify nodes
    │   ├── edges.test.ts        # Verify import/call resolution
    │   └── graph.test.ts        # Full pipeline on a fixture directory
    └── fixtures/
        └── sample-project/      # Tiny Python project for tests
            ├── main.py
            ├── utils.py
            └── models.py
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `electron` | Desktop shell |
| `@electron-forge/cli` | Build, package, distribute |
| `vite` | Bundler for main + renderer |
| `react`, `react-dom` | UI framework |
| `@xyflow/react` | React Flow v12 — graph rendering |
| `elkjs` | Layout engine |
| `tree-sitter`, `tree-sitter-python` | Python AST parsing |
| `zustand` | Renderer state management |
| `chokidar` | Cross-platform file watcher |
| `vitest` | Test runner |

Plain CSS modules for styling. No tailwind, no CSS framework.

---

## Scope Boundary

**In scope:**
- Open a Python project directory → see architecture graph
- Module-level and function-level views with expand/collapse
- Import and call edges
- Detail panel with source preview
- Search and filter
- Live re-parse on file change
- Cached graph for instant startup
- Layout position overrides

**Out of scope (future phases):**
- Annotations, ticketing, agent bridge, test generation
- Settings UI
- Multiple projects open simultaneously
- Theming, keyboard shortcuts beyond Cmd+F
- Multi-language support
- Distribution / auto-update
