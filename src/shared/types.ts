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

// --- IPC Messages ---

export type WorkerMessage =
  | { type: 'graph:ready'; data: GraphData }
  | { type: 'graph:diff'; data: GraphDiff }
  | { type: 'parse:progress'; data: { total: number; done: number } }
  | { type: 'parse:error'; data: { file: string; error: string } }
  | { type: 'worker:ready' }
