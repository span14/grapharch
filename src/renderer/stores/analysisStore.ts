import { create } from 'zustand'
import type {
  ProjectAnalysis,
  FunctionAnalysis,
  LayerAssignment,
  EdgeAnalysis,
  AnalysisProgress,
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
  status: 'idle' | 'running' | 'complete' | 'error'
  progress: AnalysisProgress | null
  error: string | null
  selectedModel: string
  viewLevel: 'layers' | 'modules' | 'functions'
  selectedLayer: string | null

  setProjectAnalysis: (p: ProjectAnalysis) => void
  setNodeAnalysis: (nodeId: string, a: NodeAnalysis) => void
  setEdgeAnalysis: (edgeId: string, a: EdgeAnalysis) => void
  setProgress: (p: AnalysisProgress) => void
  setError: (target: string, error: string) => void
  setSelectedModel: (model: string) => void
  setViewLevel: (level: 'layers' | 'modules' | 'functions') => void
  selectLayer: (layer: string | null) => void
  startAnalysis: () => void
  completeAnalysis: () => void
  reset: () => void
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  projectAnalysis: null,
  nodeAnalyses: new Map(),
  edgeAnalyses: new Map(),
  status: 'idle',
  progress: null,
  error: null,
  selectedModel: 'claude-sonnet-4-20250514',
  viewLevel: 'layers',
  selectedLayer: null,

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
      progress: null,
      error: null,
      viewLevel: 'layers',
      selectedLayer: null,
    }),
}))
