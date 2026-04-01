import type { GraphNode, GraphEdge } from '../../shared/types'
import { getFileHead, getNodeSource } from './sourceCollector'

// ── System prompts ──────────────────────────────────────────────

export const LAYER_SYSTEM = `You are a senior software architect analyzing a Python codebase.
Your task is to identify architectural layers and assign each module to exactly one layer.

Rules:
- Layers represent responsibility boundaries (e.g., Orchestration, Data Access, Business Logic, Persistence, API, Utilities)
- Every module must be assigned to exactly one layer
- Provide a distinct hex color for each layer suitable for dark backgrounds
- Be specific — use the project's domain language, not generic CS terms
- Output ONLY valid JSON, no markdown fences, no commentary`

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
  modules: GraphNode[],
  edges: GraphEdge[],
  fileSources: Map<string, string>
): string {
  const moduleList = modules.map((m) => {
    const head = getFileHead(m.filePath, fileSources, 30)
    return `### ${m.filePath}\n\`\`\`python\n${head}\n\`\`\``
  }).join('\n\n')

  // Build import adjacency list
  const importEdges = edges.filter((e) => e.kind === 'import' || e.kind === 'import_unresolved')
  const adjacency = new Map<string, Set<string>>()
  const moduleIds = new Set(modules.map((m) => m.id))
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

  return `## Modules (${modules.length} files)\n\n${moduleList}\n\n## Import Graph\n${adjStr || '  (no cross-module imports)'}\n\n## Required Output Format\n{\n  "summary": "1-paragraph architecture description",\n  "patterns": ["pattern1", "pattern2"],\n  "layers": [\n    {\n      "name": "LayerName",\n      "color": "#hexcolor",\n      "modules": ["module1.py", "module2.py"]\n    }\n  ],\n  "moduleAnalysis": {\n    "module1.py": {\n      "layer": "LayerName",\n      "confidence": 0.95,\n      "reasoning": "Why this module belongs to this layer"\n    }\n  }\n}`
}

export function buildFunctionPrompt(
  nodes: GraphNode[],
  allEdges: GraphEdge[],
  fileSources: Map<string, string>,
  layerName?: string
): string {
  const functions = nodes.map((n) => {
    const source = getNodeSource(n, fileSources)
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
  const edgeDescriptions = edges.map(({ edge, sourceNode, targetNode }) => {
    const srcSource = getNodeSource(sourceNode, fileSources)
    const tgtSource = getNodeSource(targetNode, fileSources)
    const srcLayer = layerMap?.get(sourceNode.filePath) ?? 'unknown'
    const tgtLayer = layerMap?.get(targetNode.filePath) ?? 'unknown'

    return `### ${edge.id}: ${sourceNode.label} → ${targetNode.label}\nSource (${srcLayer}):\n\`\`\`python\n${srcSource}\n\`\`\`\nTarget (${tgtLayer}):\n\`\`\`python\n${tgtSource}\n\`\`\``
  }).join('\n\n')

  return `## Edges to Analyze\n\n${edgeDescriptions}\n\n## Required Output Format\n{\n  "edges": {\n    "edge_id": {\n      "dataFlow": "What data passes from source to target",\n      "inputType": "Data shape entering the call",\n      "outputType": "Data shape returned",\n      "transformation": "How data is transformed",\n      "coupling": "moderate",\n      "couplingReason": "Why this coupling level",\n      "passedType": "List[Event]"\n    }\n  }\n}`
}
