import { create } from 'zustand'
import type {
  ProjectAnalysis,
  FunctionAnalysis,
  LayerAssignment,
  EdgeAnalysis,
  AnalysisProgress,
  ChatMessage,
  ComponentDefinition,
  ComponentEdge,
} from '../../shared/types'

export type NodeAnalysis = FunctionAnalysis | LayerAssignment

export function isLayerAssignment(a: NodeAnalysis): a is LayerAssignment {
  return 'layer' in a && 'confidence' in a
}

export function isFunctionAnalysis(a: NodeAnalysis): a is FunctionAnalysis {
  return 'summary' in a && 'parameters' in a
}

interface AnalysisState {
  projectAnalysis: ProjectAnalysis | null
  nodeAnalyses: Map<string, NodeAnalysis>
  edgeAnalyses: Map<string, EdgeAnalysis>
  status: 'idle' | 'loading' | 'running' | 'complete' | 'error'
  cacheProgress: { total: number; done: number } | null
  progress: AnalysisProgress | null
  error: string | null
  selectedModel: string
  viewLevel: 'layers' | 'components'
  selectedLayer: string | null

  // Chat
  chatMessages: Map<string, ChatMessage[]>
  chatLoading: string | null

  setProjectAnalysis: (p: ProjectAnalysis) => void
  setNodeAnalysis: (nodeId: string, a: NodeAnalysis) => void
  setEdgeAnalysis: (edgeId: string, a: EdgeAnalysis) => void
  setCacheProgress: (p: { total: number; done: number }) => void
  setProgress: (p: AnalysisProgress) => void
  setError: (target: string, error: string) => void
  setSelectedModel: (model: string) => void
  setViewLevel: (level: 'layers' | 'components') => void
  selectLayer: (layer: string | null) => void
  startAnalysis: () => void
  completeAnalysis: () => void
  reset: () => void

  // Chat actions
  addChatMessage: (layerName: string, compName: string, msg: ChatMessage) => void
  setChatLoading: (key: string | null) => void
  updateComponent: (layerName: string, oldName: string, updated: ComponentDefinition, edgeUpdates?: ComponentEdge[]) => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  projectAnalysis: null,
  nodeAnalyses: new Map(),
  edgeAnalyses: new Map(),
  status: 'idle',
  cacheProgress: null,
  progress: null,
  error: null,
  selectedModel: 'claude-sonnet-4-20250514',
  viewLevel: 'layers',
  selectedLayer: null,
  chatMessages: new Map(),
  chatLoading: null,

  setProjectAnalysis: (p) => set({ projectAnalysis: p, viewLevel: 'layers' }),

  setNodeAnalysis: (nodeId, a) =>
    set((state) => {
      const next = new Map(state.nodeAnalyses)
      next.set(nodeId, a)
      return { nodeAnalyses: next }
    }),

  setEdgeAnalysis: (edgeId, a) =>
    set((state) => {
      const next = new Map(state.edgeAnalyses)
      next.set(edgeId, a)
      return { edgeAnalyses: next }
    }),

  setCacheProgress: (p) => set({
    cacheProgress: p,
    status: p.done < p.total ? 'loading' : 'idle',
  }),

  setProgress: (p) => set({ progress: p }),

  setError: (_target, error) => set({ error, status: 'error' }),

  setSelectedModel: (model) => set({ selectedModel: model }),

  setViewLevel: (level) => set({ viewLevel: level }),

  selectLayer: (layer) => set({ selectedLayer: layer }),

  startAnalysis: () => set({ status: 'running', error: null, progress: null }),

  completeAnalysis: () => set({ status: 'complete' }),

  reset: () =>
    set({
      projectAnalysis: null,
      nodeAnalyses: new Map(),
      edgeAnalyses: new Map(),
      status: 'idle',
      cacheProgress: null,
      progress: null,
      error: null,
      viewLevel: 'layers',
      selectedLayer: null,
      chatMessages: new Map(),
      chatLoading: null,
    }),

  addChatMessage: (layerName, compName, msg) =>
    set((state) => {
      const key = `${layerName}:${compName}`
      const next = new Map(state.chatMessages)
      let msgs = [...(next.get(key) ?? []), msg]
      // Cap at 100 messages per component
      if (msgs.length > 100) {
        msgs = msgs.slice(-100)
      }
      // Strip componentUpdate and edgeUpdates from messages older than the last 5
      if (msgs.length > 5) {
        msgs = msgs.map((m, i) => {
          if (i < msgs.length - 5 && (m.componentUpdate || m.edgeUpdates)) {
            const { componentUpdate, edgeUpdates, ...rest } = m
            return rest as ChatMessage
          }
          return m
        })
      }
      next.set(key, msgs)
      return { chatMessages: next }
    }),

  setChatLoading: (key) => set({ chatLoading: key }),

  updateComponent: (layerName, oldName, updated, edgeUpdates) =>
    set((state) => {
      if (!state.projectAnalysis) return state
      const layers = state.projectAnalysis.layers.map((l) => {
        if (l.name !== layerName) return l
        const components = (l.components ?? []).map((c) =>
          c.name === oldName ? updated : c
        )
        return {
          ...l,
          components,
          componentEdges: edgeUpdates ?? l.componentEdges,
        }
      })
      return { projectAnalysis: { ...state.projectAnalysis, layers } }
    }),
}))
