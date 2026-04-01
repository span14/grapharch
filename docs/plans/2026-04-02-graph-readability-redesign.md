# Graph Readability Redesign

## Problem

The current graph view shows all 21 modules and 316 edges at once. It's messy, edges blend together, and there's no strict input/output type display. The user can't understand the architecture at a glance.

## Design

### Three-level drill-down

**Level 1 — Layer overview** (default after analysis):
- Layers as large container nodes (e.g., "API Gateway", "Pipeline Orchestration", "ML Inference", "Persistence")
- Each container shows: layer name, color, module list, module count
- Thick directional arrows between layers showing aggregate data flow
- Click a layer → zoom to Level 2

**Level 2 — Module view** (within a layer + cross-layer edges):
- Modules from the selected layer shown with layer color
- Cross-layer connections shown as edges to/from other layers
- Module nodes show layer color band
- Click ► on a module → expand to Level 3

**Level 3 — Function type signature cards**:
```
┌─────────────────────────────────────────┐
│ ● bootstrap()                    high  │
│─────────────────────────────────────────│
│ IN   pool: Pool                        │
│      config: Config                    │
│      platforms: List[str]              │
│─────────────────────────────────────────│
│ OUT  BootstrapResponse                 │
└─────────────────────────────────────────┘
```

### Edge design

- Thick lines with arrowheads (SVG marker-end)
- Type label at midpoint: the concrete type being passed (`List[Event]`, `np.ndarray`)
- Coupling colors: green (loose), yellow (moderate), red (tight)
- At layer level: aggregate edges with primary data types

### Prompt changes

Update function analysis prompt to extract:
- Concrete parameter types (not prose descriptions)
- Concrete return type string
- Edge type labels: the exact type passed between caller and callee

Update edge analysis prompt to extract:
- `passedType`: the concrete type on the edge (`List[Event]`, `str`, `Config`)
- Keep coupling analysis

### State changes

Add to graphStore or analysisStore:
- `viewLevel`: 'layers' | 'modules' | 'functions'
- `selectedLayer`: string | null (which layer is drilled into)
- Navigation: breadcrumb showing current drill-down path
