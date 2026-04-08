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

export interface ComponentDefinition {
  name: string
  pseudocode: string          // step-by-step pseudocode of what this component does
  description: string         // one-line summary
  functions: string[]         // function/class IDs belonging to this component
  output?: TypeDetail         // what this component produces
}

export interface ComponentEdge {
  source: string              // component name
  target: string              // component name
  dataFormat: string          // e.g. "List[Event]", "Config dict"
  description: string         // what data flows and why
}

export interface TypeDetail {
  type: string                // e.g. "MatchResult", "List[Event]"
  interpretation: string      // what this type represents
  codeReference?: string      // e.g. "src/pairing/models.py:42"
}

export interface LayerEdge {
  source: string              // source layer name
  target: string              // target layer name
  description: string         // abstract interpretation, e.g. "Sends matched events for storage"
  dataFormats: TypeDetail[]   // concrete types with interpretation
}

export interface LayerDefinition {
  name: string
  color: string
  modules: string[]
  components?: ComponentDefinition[]
  componentEdges?: ComponentEdge[]
}

export interface ProjectAnalysis {
  layers: LayerDefinition[]
  layerEdges?: LayerEdge[]
  summary: string
  patterns: string[]
  analyzedAt: string
}

export interface AnalysisProgress {
  phase: 'layers' | 'components'
  total: number
  done: number
}

// --- Component Chat ---

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  timestamp: string
  componentUpdate?: ComponentDefinition
  edgeUpdates?: ComponentEdge[]
}

export interface ComponentChatRequest {
  requestId: string
  layerName: string
  componentName: string
  message: string
  chatHistory: ChatMessage[]
  component: ComponentDefinition
  neighborComponents: ComponentDefinition[]
  componentEdges: ComponentEdge[]
  rootDir: string
  model?: string
}

export interface ComponentChatResponse {
  requestId: string
  layerName: string
  componentName: string
  text: string
  componentUpdate?: ComponentDefinition
  edgeUpdates?: ComponentEdge[]
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
  | { type: 'analysis:cache-loading'; data: { total: number; done: number } }
  // Component chat
  | { type: 'component:chat-response'; data: ComponentChatResponse }
  | { type: 'component:chat-error'; data: { requestId: string; error: string } }
