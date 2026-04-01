# GraphArc — Design Document

> Interactive code architecture graph with a closed-loop AI agent pipeline.
> See the structure. Annotate the problems. Agents fix the code. Graph updates.

---

## High-Level Overview

GraphArc is a visual control plane for AI-managed codebases. The architecture follows a closed loop:

```
Codebase → Parser → Graph Data → Renderer → User Annotation
                                                   │
                                                   ▼
                                            LLM → Ticket
                                                   │
                                                   ▼
                                          Agent → Code Fix
                                                   │
                                                   ▼
                                          Re-parse → Graph Update
```

The primary interface is an interactive architecture graph — not a code editor.
Humans steer through the graph; agents execute through the code.

---

## Core Loop

### 1. Parse (`src/parser/`)

Static analysis extracts a typed graph from the codebase.

```
Source Files → tree-sitter ASTs → Symbol Extraction → Call/Import Resolution → Graph JSON
```

| Component | Purpose |
|-----------|---------|
| `treeSitter.ts` | tree-sitter bindings, grammar loading, incremental parse |
| `symbolExtractor.ts` | Extract functions, classes, modules from ASTs |
| `edgeResolver.ts` | Resolve imports, calls, message passing between symbols |
| `graphBuilder.ts` | Assemble nodes + edges into the canonical `GraphData` format |
| `watcher.ts` | fs.watch for file changes → incremental re-parse |

Language support via tree-sitter grammars — Python, TypeScript, Go out of the box.
New languages are a grammar file, not a code change.

#### Graph Data Model

```typescript
interface GraphData {
  nodes: Node[]
  edges: Edge[]
  metadata: RepoMetadata
}

interface Node {
  id: string                          // "src/pairing/db.py::load_events"
  kind: "module" | "class" | "function" | "endpoint" | "table" | "service"
  label: string                       // "load_events"
  filePath: string                    // "src/pairing/db.py"
  lineRange: [number, number]         // [146, 187]
  language: string                    // "python"
  parent?: string                     // module or class this belongs to
  annotations: Annotation[]           // user-attached annotations
  metadata: Record<string, unknown>   // language-specific extras
}

interface Edge {
  id: string
  source: string                      // node id
  target: string                      // node id
  kind: "import" | "call" | "inherit" | "message" | "db_query" | "http"
  label?: string                      // "POST /match"
  weight?: number                     // call frequency, coupling score
  metadata: Record<string, unknown>
}
```

### 2. Render (`src/renderer/`)

React Flow renders the graph as an interactive, zoomable canvas.

```
GraphData → ELK layout → React Flow nodes/edges → Canvas
```

| Component | Purpose |
|-----------|---------|
| `Canvas.tsx` | Root React Flow container — zoom, pan, minimap |
| `LayoutEngine.ts` | ELK.js wrapper — hierarchical or force-directed layout |
| `NodeRenderer.tsx` | Custom node components per `node.kind` |
| `EdgeRenderer.tsx` | Custom edge components per `edge.kind` |
| `SubflowExpander.tsx` | Click a module node → expand to show internal functions |
| `FilterPanel.tsx` | Filter by kind, language, path glob, annotation status |
| `SearchOverlay.tsx` | Fuzzy search across nodes and edges |

#### Node Variants

| Kind | Visual | Contents |
|------|--------|----------|
| `module` | Rounded rectangle, collapsible | File name, function count, health indicator |
| `class` | Rectangle with header | Class name, method list |
| `function` | Pill shape | Name, signature, line count |
| `endpoint` | Hexagon | Method + path (`POST /match`) |
| `table` | Cylinder | Table name, column count |
| `service` | Cloud shape | External service name |

### 3. Annotate (`src/annotations/`)

User clicks a node or edge, types a natural-language observation.

```
User clicks node → Annotation panel opens → User types issue → Annotation saved
```

| Component | Purpose |
|-----------|---------|
| `AnnotationPanel.tsx` | Side panel for viewing/adding annotations on selected element |
| `AnnotationStore.ts` | Persistence layer — annotations stored alongside graph data |
| `AnnotationBadge.tsx` | Visual indicator on nodes/edges that have annotations |
| `types.ts` | Annotation data model |

#### Annotation Data Model

```typescript
interface Annotation {
  id: string
  targetId: string               // node or edge id
  targetKind: "node" | "edge"
  author: string                 // user or "agent"
  text: string                   // natural language: "this coupling is wrong"
  intent: "issue" | "question" | "suggestion" | "test_request"
  status: "open" | "ticketed" | "in_progress" | "resolved"
  ticketRef?: string             // "PRD-123" or GitHub issue URL
  createdAt: string
  resolvedAt?: string
}
```

### 4. Ticket (`src/ticketing/`)

LLM converts annotation context into a structured ticket.

```
Annotation + Node context + Source code → LLM → Structured ticket → Linear/GitHub API
```

| Component | Purpose |
|-----------|---------|
| `ticketGenerator.ts` | Builds prompt from annotation + graph context, calls LLM |
| `ticketFormatter.ts` | Formats LLM output into platform-specific ticket schema |
| `linearAdapter.ts` | Linear API integration — create issue, update status |
| `githubAdapter.ts` | GitHub Issues API integration |
| `types.ts` | Ticket data model, adapter interface |

The LLM receives:

1. **The annotation text** — what the user observed
2. **Node/edge context** — what part of the architecture is involved
3. **Source code** — the actual code at the annotated location
4. **Surrounding graph** — 1-hop neighbors to understand coupling

And produces:

```typescript
interface GeneratedTicket {
  title: string                  // "Decouple db.load_events from Market table filter"
  description: string            // Markdown body with context, problem, suggested fix
  labels: string[]               // ["refactor", "coupling", "pairing"]
  priority: "p0" | "p1" | "p2" | "p3"
  acceptanceCriteria: string[]   // Testable conditions for resolution
  suggestedTests: TestSkeleton[] // e2e test outlines (see section 6)
}
```

### 5. Agent Fix (`src/agent/`)

An AI coding agent picks up the ticket and implements the fix.

```
Ticket → Agent receives ticket + spec context → Code changes → Validation → PR
```

| Component | Purpose |
|-----------|---------|
| `agentBridge.ts` | Interface to external agent systems (symphony, trellis, Claude Code) |
| `contextBuilder.ts` | Assembles relevant specs, code, and graph context for the agent |
| `statusTracker.ts` | Polls ticket status, maps to annotation status |
| `types.ts` | Agent integration types |

GraphArc does **not** implement its own coding agent. It delegates to:

| Agent System | Integration |
|--------------|-------------|
| **Trellis/Symphony** | Writes task directory, sets current-task, agents receive specs via hooks |
| **Claude Code** | Spawns a Claude Code session with the ticket as prompt |
| **Devin / Sweep / Custom** | Webhook-based — POST ticket payload to agent API |

The bridge pattern:

```typescript
interface AgentBridge {
  submit(ticket: GeneratedTicket, context: AgentContext): Promise<AgentRun>
  getStatus(runId: string): Promise<AgentRunStatus>
  onComplete(runId: string, callback: (result: AgentResult) => void): void
}
```

### 6. Re-parse & Update (`src/sync/`)

After the agent commits, the graph re-parses and reflects changes.

```
File watcher detects change → Incremental re-parse → Diff old/new graph → Animate transition
```

| Component | Purpose |
|-----------|---------|
| `graphDiff.ts` | Computes node/edge additions, removals, modifications between two graphs |
| `transitionAnimator.ts` | Animates graph changes — new nodes fade in, removed nodes fade out |
| `annotationReconciler.ts` | Resolves annotations: marks "resolved" if target node changed per acceptance criteria |
| `historyStore.ts` | Stores graph snapshots for time-travel ("show me the graph before this fix") |

The diff output:

```typescript
interface GraphDiff {
  nodesAdded: Node[]
  nodesRemoved: string[]         // node ids
  nodesModified: NodePatch[]     // changed properties
  edgesAdded: Edge[]
  edgesRemoved: string[]
  edgesModified: EdgePatch[]
}
```

---

## Test Generation (`src/testing/`)

When a user annotates with `intent: "test_request"`, or when a ticket includes `suggestedTests`, the system generates e2e test skeletons.

```
User selects path in graph (A → B → C) → Extract source for each node
  → LLM generates test skeleton covering the interaction chain
```

| Component | Purpose |
|-----------|---------|
| `pathSelector.ts` | User shift-clicks nodes to define a path through the graph |
| `testGenerator.ts` | Builds prompt from path nodes + source, calls LLM for test code |
| `testTemplates.ts` | Language-specific test boilerplate (pytest, vitest, go test) |
| `testPreview.tsx` | Side panel showing generated test with copy/save actions |

#### Test Skeleton Data Model

```typescript
interface TestSkeleton {
  path: string[]                 // node ids forming the tested path
  framework: string              // "pytest" | "vitest" | "go_test"
  code: string                   // generated test code
  mocks: MockSpec[]              // what to mock and why
  description: string            // human-readable test intent
}

interface MockSpec {
  target: string                 // "src/pairing/db.py::load_events"
  reason: string                 // "External DB dependency"
  returnShape: string            // type hint for mock return value
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         GraphArc                                    │
│                                                                     │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌────────────────┐  │
│  │  Parser   │→│  Graph DB  │→│  Renderer   │→│  Annotation UI  │  │
│  │           │  │           │  │  (React     │  │                │  │
│  │  tree-    │  │  Nodes +  │  │   Flow)     │  │  Panel, Badge, │  │
│  │  sitter   │  │  Edges +  │  │            │  │  Path Select   │  │
│  │  + LSP    │  │  History  │  │  ELK layout│  │                │  │
│  └──────────┘  └─────┬─────┘  └────────────┘  └───────┬────────┘  │
│                       │                                 │           │
│                       │  ┌──────────────────────────────┘           │
│                       │  │                                          │
│                       ▼  ▼                                          │
│               ┌──────────────┐     ┌─────────────┐                 │
│               │  Ticket Gen  │────→│  Agent       │                 │
│               │  (LLM)       │     │  Bridge      │                 │
│               │              │     │              │                 │
│               │  Annotation  │     │  Trellis /   │                 │
│               │  + context   │     │  Claude Code /│                │
│               │  → ticket    │     │  Webhook     │                 │
│               └──────────────┘     └──────┬──────┘                 │
│                                           │                         │
│                                           ▼                         │
│                                    ┌─────────────┐                  │
│                                    │  Sync       │                  │
│                                    │             │                  │
│                                    │  Watch →    │                  │
│                                    │  Re-parse → │                  │
│                                    │  Diff →     │                  │
│                                    │  Animate    │                  │
│                                    └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
grapharc/
├── design.md                    # This document
├── package.json
├── tsconfig.json
│
├── src/
│   ├── parser/
│   │   ├── treeSitter.ts        # tree-sitter bindings, grammar loading
│   │   ├── symbolExtractor.ts   # AST → symbols (functions, classes, modules)
│   │   ├── edgeResolver.ts      # Resolve imports, calls, message passing
│   │   ├── graphBuilder.ts      # Assemble canonical GraphData
│   │   ├── watcher.ts           # File system watcher for incremental re-parse
│   │   └── languages/           # Per-language extraction configs
│   │       ├── python.ts
│   │       ├── typescript.ts
│   │       └── go.ts
│   │
│   ├── renderer/
│   │   ├── Canvas.tsx           # Root React Flow container
│   │   ├── LayoutEngine.ts     # ELK.js layout wrapper
│   │   ├── NodeRenderer.tsx    # Custom node components by kind
│   │   ├── EdgeRenderer.tsx    # Custom edge components by kind
│   │   ├── SubflowExpander.tsx # Module → internal function expansion
│   │   ├── FilterPanel.tsx     # Filter by kind, language, path, status
│   │   └── SearchOverlay.tsx   # Fuzzy node/edge search
│   │
│   ├── annotations/
│   │   ├── AnnotationPanel.tsx  # Side panel for adding/viewing annotations
│   │   ├── AnnotationStore.ts  # Persistence layer
│   │   ├── AnnotationBadge.tsx # Visual indicator on annotated elements
│   │   └── types.ts            # Annotation data model
│   │
│   ├── ticketing/
│   │   ├── ticketGenerator.ts  # Annotation + context → LLM → ticket
│   │   ├── ticketFormatter.ts  # Format for target platform
│   │   ├── linearAdapter.ts    # Linear API
│   │   ├── githubAdapter.ts    # GitHub Issues API
│   │   └── types.ts            # Ticket types, adapter interface
│   │
│   ├── agent/
│   │   ├── agentBridge.ts      # Interface to agent systems
│   │   ├── contextBuilder.ts   # Build spec context for the agent
│   │   ├── statusTracker.ts    # Poll ticket/agent status
│   │   └── types.ts            # Agent integration types
│   │
│   ├── testing/
│   │   ├── pathSelector.ts     # Shift-click path selection in graph
│   │   ├── testGenerator.ts    # Path + source → LLM → test skeleton
│   │   ├── testTemplates.ts    # Per-framework boilerplate
│   │   └── testPreview.tsx     # Preview panel with copy/save
│   │
│   ├── sync/
│   │   ├── graphDiff.ts        # Compute diff between graph snapshots
│   │   ├── transitionAnimator.ts # Animate graph changes
│   │   ├── annotationReconciler.ts # Auto-resolve annotations after fix
│   │   └── historyStore.ts     # Graph snapshot history (time-travel)
│   │
│   ├── server/
│   │   ├── api.ts              # REST API for graph data, annotations, tickets
│   │   ├── websocket.ts        # Live graph updates pushed to client
│   │   └── mcp.ts              # MCP server — expose graph as MCP resources
│   │
│   └── types/
│       ├── graph.ts            # GraphData, Node, Edge
│       ├── annotation.ts       # Annotation types
│       ├── ticket.ts           # Ticket types
│       └── config.ts           # Configuration schema
│
├── web/                         # React frontend (Vite)
│   ├── index.html
│   ├── App.tsx                  # Root — Canvas + panels
│   ├── components/              # Shared UI components
│   └── hooks/                   # React hooks
│
└── cli/                         # Optional CLI interface
    └── grapharc.ts              # CLI for parse, serve, annotate
```

---

## Tech Stack

| Category | Technology | Why |
|----------|------------|-----|
| **Runtime** | Node.js / Bun | tree-sitter native bindings, fast startup |
| **Language** | TypeScript (strict) | Type safety across graph data pipeline |
| **Parsing** | tree-sitter | Incremental, multi-language, battle-tested |
| **Graph Layout** | ELK.js | Best automatic layout for directed dependency graphs |
| **Graph Rendering** | React Flow (XYFlow) | Interactive nodes/edges, custom components, subflows |
| **Frontend** | React + Vite | Standard, fast HMR |
| **LLM** | Claude API (Anthropic SDK) | Ticket generation, test generation, annotation analysis |
| **Ticket Adapters** | Linear SDK, Octokit | Ticket creation and status sync |
| **Agent Bridge** | Trellis, Claude Code, webhooks | Delegate code fixes to external agent systems |
| **Persistence** | SQLite (local) or Postgres | Graph snapshots, annotations, ticket state |
| **Real-time** | WebSocket | Push graph updates to connected clients |
| **MCP** | MCP SDK | Expose graph as resources/tools for AI assistants |

---

## Configuration

```toml
# grapharc.toml

[parser]
languages = ["python", "typescript"]
root = "."
ignore = ["node_modules", ".venv", "__pycache__", "dist"]

[renderer]
layout = "elk-hierarchical"          # elk-hierarchical | elk-force | dagre
theme = "dark"

[ticketing]
provider = "linear"                  # linear | github | none
project = "PRD"
default_labels = ["from-grapharc"]

[agent]
bridge = "trellis"                   # trellis | claude-code | webhook
webhook_url = ""                     # for webhook bridge

[llm]
provider = "anthropic"
model = "claude-sonnet-4-6"          # ticket/test generation
api_key_env = "ANTHROPIC_API_KEY"

[server]
port = 3100
host = "localhost"
```

---

## MCP Integration

GraphArc exposes an MCP server so AI assistants can query the architecture graph.

### Resources

| Resource | URI | Description |
|----------|-----|-------------|
| Graph data | `grapharc://graph` | Full graph JSON |
| Node detail | `grapharc://node/{id}` | Single node with source code and annotations |
| Annotations | `grapharc://annotations` | All open annotations |
| Graph diff | `grapharc://diff/{snapshotA}/{snapshotB}` | Diff between two snapshots |

### Tools

| Tool | Description |
|------|-------------|
| `get_node` | Get node by ID with source code |
| `get_neighbors` | Get 1-hop neighbors of a node |
| `search_nodes` | Search nodes by label, kind, path |
| `add_annotation` | Programmatically annotate a node/edge |
| `get_annotations` | List annotations, filtered by status |
| `generate_test` | Generate test skeleton for a path |

This means an AI agent can ask: *"What are the open annotations on the matching module?"* or *"Show me all endpoints and their database dependencies."*

---

## Phased Delivery

### Phase 1 — Static Graph Viewer

- tree-sitter parser for Python
- React Flow renderer with ELK layout
- Module-level and function-level views
- File watcher for live re-parse

### Phase 2 — Annotations + Tickets

- Annotation UI (panel, badges, path selection)
- LLM ticket generation
- Linear/GitHub adapter
- Annotation status tracking

### Phase 3 — Agent Loop + Test Generation

- Agent bridge (Trellis, Claude Code, webhook)
- Status sync (ticket → annotation resolution)
- Graph diff + animated transitions
- e2e test skeleton generation from paths

### Phase 4 — MCP + Multi-repo

- MCP server for AI assistant integration
- Multi-repo support (monorepo, microservices)
- Graph history + time-travel
- Collaborative annotations (multi-user)

---

## See Also

- [React Flow](https://reactflow.dev) — Graph rendering library
- [tree-sitter](https://tree-sitter.github.io) — Incremental parsing
- [ELK.js](https://github.com/kieler/elkjs) — Layout engine
- [Trellis](../.trellis/workflow.md) — Agent orchestration workflow
