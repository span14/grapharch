// --- Graph Data ---

export interface RepoMetadata {
  rootDir: string
  fileCount: number
  parsedAt: string
}

export interface GraphNode {
  id: string                          // "src/pairing/db.py::load_events"
  kind: 'module' | 'class' | 'function' | 'method'
  label: string                       // "load_events"
  filePath: string                    // "src/pairing/db.py"
  lineRange: [number, number]         // [146, 187]
  parent?: string                     // module or class this belongs to
  childCount?: number                 // functions/classes inside (for modules)
  metadata: Record<string, unknown>   // async, decorators, etc.
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'import' | 'call' | 'import_unresolved'
  weight?: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata: RepoMetadata
}

// --- Diffs ---

export interface NodePatch {
  id: string
  changes: Partial<GraphNode>
}

export interface GraphDiff {
  nodesAdded: GraphNode[]
  nodesRemoved: string[]
  nodesModified: NodePatch[]
  edgesAdded: GraphEdge[]
  edgesRemoved: string[]
}

// --- AI Analysis ---

export interface ParameterInfo {
  name: string
  type: string
  description: string
}

export interface FunctionAnalysis {
  summary: string
  codePreview: string
  parameters: ParameterInfo[]
  returnType: string
  complexity: 'low' | 'medium' | 'high'
  complexityReason: string
  sideEffects: string[]
}

export interface LayerAssignment {
  layer: string
  confidence: number
  reasoning: string
}

export interface EdgeAnalysis {
  dataFlow: string
  inputType: string
  outputType: string
  transformation: string
  coupling: 'loose' | 'moderate' | 'tight'
  couplingReason: string
  passedType: string  // concrete Python type on the edge, e.g. "List[Event]"
}

export interface LayerDefinition {
  name: string
  color: string
  modules: string[]
}

export interface ProjectAnalysis {
  layers: LayerDefinition[]
  summary: string
  patterns: string[]
  analyzedAt: string
}

export interface AnalysisProgress {
  phase: 'layers' | 'functions' | 'edges'
  total: number
  done: number
}

// --- IPC Messages ---

export type WorkerMessage =
  | { type: 'graph:ready'; data: GraphData }
  | { type: 'graph:diff'; data: GraphDiff }
  | { type: 'parse:progress'; data: { total: number; done: number } }
  | { type: 'parse:error'; data: { file: string; error: string } }
  | { type: 'worker:ready' }
  // Analysis messages
  | { type: 'analysis:progress'; data: AnalysisProgress }
  | { type: 'analysis:node'; data: { nodeId: string; analysis: FunctionAnalysis | LayerAssignment } }
  | { type: 'analysis:edge'; data: { edgeId: string; analysis: EdgeAnalysis } }
  | { type: 'analysis:project'; data: ProjectAnalysis }
  | { type: 'analysis:error'; data: { target: string; error: string } }
  | { type: 'analysis:complete' }
