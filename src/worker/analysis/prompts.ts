import type { GraphNode, GraphEdge } from '../../shared/types'

// ── System prompts ──────────────────────────────────────────────

export const LAYER_SYSTEM = `You are a senior software architect analyzing a Python project.
You have access to tools: Read files, Grep for patterns, Glob to find files.
Use these tools to explore the codebase and understand its architecture.

Your task:
1. Use the provided dependency graph to understand module relationships
2. Read key files to understand what each module does (you don't need to read every file — focus on imports, class/function signatures, and docstrings)
3. Identify architectural layers and assign each module to exactly one layer
4. Describe data flow relationships between layers at an abstract level

Rules:
- Layers represent responsibility boundaries — use the project's domain language, not generic CS terms
- Every module in the graph must be assigned to exactly one layer
- Provide a distinct hex color for each layer suitable for dark backgrounds
- For layerEdges: describe WHAT data flows between layers and WHY at an abstract level
- Only include layerEdges where there is a real dependency
- Output ONLY valid JSON, no markdown fences, no commentary`

export const COMPONENT_SYSTEM = `You are a senior software architect doing a deep dive into one architectural layer of a Python project.
You have access to tools: Read files, Grep for patterns, Glob to find files.
Use these tools to read the actual source code and understand the logic.

Your task:
1. Read the source files of the functions listed below to understand what they do
2. Group functions into logical components — abstract responsibilities (e.g., "Event Matcher", "Cache Manager", "Template Extractor")
3. Write pseudocode for each component describing WHAT it does step-by-step
4. Identify data flow edges between components with concrete data formats

Rules:
- Each component must have a clear, domain-specific name
- Pseudocode must be algorithmic (step-by-step), not a description
- Every listed function must belong to exactly one component
- Component edges describe data that flows between components with concrete types
- Output ONLY valid JSON, no markdown fences, no commentary`

// ── Kept for future on-demand use ──────────────────────────────

export const FUNCTION_SYSTEM = `You are a senior software engineer analyzing Python functions.
For each function, provide a concise technical analysis.

Rules:
- Summary must be 1-2 sentences describing what the function does, not how
- Parameters: use concrete Python types (e.g., "List[Event]", "asyncpg.Pool", "str"), not prose descriptions. If no annotation exists, infer the type from usage.
- returnType: concrete Python type (e.g., "List[MatchGroup]", "None", "float"). Not a description.
- Complexity: low (linear, no branching), medium (conditionals, single loop), high (nested loops, recursion, complex state)
- Side effects: list external interactions (database, network, file I/O, global state mutation)
- Output ONLY valid JSON, no markdown fences, no commentary`

export const EDGE_SYSTEM = `You are a senior software engineer analyzing data flow between Python functions.
For each caller→callee relationship, describe what data passes between them.

Rules:
- dataFlow: describe the actual data being passed (not just "calls function")
- inputType/outputType: describe the data shape, not just the Python type name
- transformation: how the callee transforms or uses the input
- coupling: loose (simple value passing), moderate (shared data structures), tight (shared mutable state, callbacks, complex contracts)
- passedType: the concrete Python type being passed from caller to callee on this edge (e.g. "List[Event]", "str", "Config"). Be specific — use the actual type, not a description.
- Output ONLY valid JSON, no markdown fences, no commentary`

// ── User prompt builders ────────────────────────────────────────

export function buildLayerPrompt(
  rootDir: string,
  modules: GraphNode[],
  edges: GraphEdge[],
): string {
  // Compact module list — just IDs and child counts
  const moduleList = modules
    .map((m) => `  ${m.id} (${m.childCount ?? 0} functions)`)
    .join('\n')

  // Import adjacency
  const importEdges = edges.filter((e) => e.kind === 'import' || e.kind === 'import_unresolved')
  const moduleIds = new Set(modules.map((m) => m.id))
  const adjacency = new Map<string, Set<string>>()
  for (const e of importEdges) {
    if (moduleIds.has(e.source) && moduleIds.has(e.target)) {
      const set = adjacency.get(e.source) ?? new Set()
      set.add(e.target)
      adjacency.set(e.source, set)
    }
  }
  const adjStr = Array.from(adjacency.entries())
    .map(([src, targets]) => `  ${src} → ${Array.from(targets).join(', ')}`)
    .join('\n')

  // Call edge summary (module-to-module counts)
  const callCounts = new Map<string, number>()
  for (const e of edges) {
    if (e.kind === 'call') {
      const srcMod = e.source.split('::')[0]
      const tgtMod = e.target.split('::')[0]
      if (srcMod !== tgtMod && moduleIds.has(srcMod) && moduleIds.has(tgtMod)) {
        const key = `${srcMod} → ${tgtMod}`
        callCounts.set(key, (callCounts.get(key) ?? 0) + 1)
      }
    }
  }
  const callStr = Array.from(callCounts.entries())
    .map(([key, count]) => `  ${key} (${count} calls)`)
    .join('\n')

  return `## Project Root
${rootDir}

## Modules (${modules.length} files)
${moduleList}

## Import Graph
${adjStr || '  (no cross-module imports)'}

## Call Graph (module-to-module summary)
${callStr || '  (no cross-module calls)'}

## Instructions
1. Use Read to examine key files — focus on imports, class definitions, and function signatures
2. You don't need to read every file — sample representative ones to understand each module's role

## Required Output Format
{
  "summary": "1-paragraph architecture description",
  "patterns": ["pattern1", "pattern2"],
  "layers": [
    {
      "name": "LayerName",
      "color": "#hexcolor",
      "modules": ["module1.py", "module2.py"]
    }
  ],
  "layerEdges": [
    {
      "source": "SourceLayerName",
      "target": "TargetLayerName",
      "description": "Abstract description of what flows and why",
      "dataFormats": ["List[Event]", "MatchResult"]
    }
  ],
  "moduleAnalysis": {
    "module1.py": {
      "layer": "LayerName",
      "confidence": 0.95,
      "reasoning": "Why this module belongs to this layer"
    }
  }
}`
}

export function buildComponentPrompt(
  rootDir: string,
  layerName: string,
  modules: string[],
  functions: GraphNode[],
  edges: GraphEdge[],
): string {
  // Compact function list with file:line references
  const fnList = functions
    .map((n) => `  ${n.id} (${n.kind}, ${n.filePath}:${n.lineRange[0]}-${n.lineRange[1]})`)
    .join('\n')

  // Internal call graph
  const fnIds = new Set(functions.map((f) => f.id))
  const internalEdges = edges.filter(
    (e) => e.kind === 'call' && fnIds.has(e.source) && fnIds.has(e.target)
  )
  const edgeStr = internalEdges.length > 0
    ? internalEdges.map((e) => `  ${e.source.split('::').pop()} → ${e.target.split('::').pop()}`).join('\n')
    : '  (no internal calls)'

  return `## Project Root
${rootDir}

## Layer: ${layerName}

## Modules in this layer
${modules.map((m) => `  ${m}`).join('\n')}

## Functions (${functions.length})
${fnList}

## Internal Call Graph
${edgeStr}

## Instructions
1. Use Read to examine the source code of functions in this layer
2. Focus on understanding WHAT each function does and how they work together
3. Group them into logical components with pseudocode

## Required Output Format
{
  "components": [
    {
      "name": "ComponentName",
      "description": "One-line summary of responsibility",
      "pseudocode": "1. Load configuration\\n2. For each event:\\n   a. Extract features\\n   b. Match against index\\n3. Return matched pairs",
      "functions": ["module.py::func1", "module.py::func2"]
    }
  ],
  "componentEdges": [
    {
      "source": "ComponentA",
      "target": "ComponentB",
      "dataFormat": "List[Event]",
      "description": "Passes matched events for persistence"
    }
  ]
}`
}

// ── Kept for future on-demand use ──────────────────────────────

export { getFileHead, getNodeSource } from './sourceCollector'

export function buildFunctionPrompt(
  nodes: GraphNode[],
  allEdges: GraphEdge[],
  fileSources: Map<string, string>,
  layerName?: string
): string {
  const { getNodeSource: getSrc } = require('./sourceCollector')
  const functions = nodes.map((n) => {
    const source = getSrc(n, fileSources)
    const callers = allEdges
      .filter((e) => e.target === n.id && e.kind === 'call')
      .map((e) => e.source)
    const callees = allEdges
      .filter((e) => e.source === n.id && e.kind === 'call')
      .map((e) => e.target)

    return `### ${n.label} (${n.kind}, lines ${n.lineRange[0]}-${n.lineRange[1]})\n\`\`\`python\n${source}\n\`\`\`\nCalled by: ${callers.length ? callers.join(', ') : 'none'}\nCalls: ${callees.length ? callees.join(', ') : 'none'}`
  }).join('\n\n')

  const layerCtx = layerName ? `\nLayer: ${layerName}` : ''

  return `## Module Context\nFile: ${nodes[0]?.filePath ?? 'unknown'}${layerCtx}\n\n## Functions to Analyze\n\n${functions}\n\n## Required Output Format\n{\n  "functions": {\n    "function_name": {\n      "summary": "What this function does in 1-2 sentences",\n      "parameters": [{"name": "x", "type": "str", "description": "..."}],\n      "returnType": "List[Event]",\n      "complexity": "medium",\n      "complexityReason": "Contains nested loops with conditional branching",\n      "sideEffects": ["database query"]\n    }\n  }\n}`
}

export function buildEdgePrompt(
  edges: Array<{ edge: GraphEdge; sourceNode: GraphNode; targetNode: GraphNode }>,
  fileSources: Map<string, string>,
  layerMap?: Map<string, string>
): string {
  const { getNodeSource: getSrc } = require('./sourceCollector')
  const edgeDescriptions = edges.map(({ edge, sourceNode, targetNode }) => {
    const srcSource = getSrc(sourceNode, fileSources)
    const tgtSource = getSrc(targetNode, fileSources)
    const srcLayer = layerMap?.get(sourceNode.filePath) ?? 'unknown'
    const tgtLayer = layerMap?.get(targetNode.filePath) ?? 'unknown'

    return `### ${edge.id}: ${sourceNode.label} → ${targetNode.label}\nSource (${srcLayer}):\n\`\`\`python\n${srcSource}\n\`\`\`\nTarget (${tgtLayer}):\n\`\`\`python\n${tgtSource}\n\`\`\``
  }).join('\n\n')

  return `## Edges to Analyze\n\n${edgeDescriptions}\n\n## Required Output Format\n{\n  "edges": {\n    "edge_id": {\n      "dataFlow": "What data passes from source to target",\n      "inputType": "Data shape entering the call",\n      "outputType": "Data shape returned",\n      "transformation": "How data is transformed",\n      "coupling": "moderate",\n      "couplingReason": "Why this coupling level",\n      "passedType": "List[Event]"\n    }\n  }\n}`
}
