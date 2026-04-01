import { create } from 'zustand'
import type { GraphData, GraphDiff } from '../../shared/types'

interface GraphState {
  graph: GraphData | null
  selectedNodeId: string | null
  expandedModules: Set<string>
  loading: boolean
  error: string | null

  setGraph: (data: GraphData) => void
  applyDiff: (diff: GraphDiff) => void
  selectNode: (id: string | null) => void
  toggleModule: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  graph: null,
  selectedNodeId: null,
  expandedModules: new Set(),
  loading: false,
  error: null,

  setGraph: (data) => set({ graph: data, loading: false, error: null }),
  applyDiff: (diff) =>
    set((state) => {
      if (!state.graph) return state
      const nodes = [...state.graph.nodes]
      const edges = [...state.graph.edges]

      // Remove
      const removeNodeIds = new Set(diff.nodesRemoved)
      const removeEdgeIds = new Set(diff.edgesRemoved)
      const filteredNodes = nodes.filter((n) => !removeNodeIds.has(n.id))
      const filteredEdges = edges.filter((e) => !removeEdgeIds.has(e.id))

      // Modify
      for (const patch of diff.nodesModified) {
        const idx = filteredNodes.findIndex((n) => n.id === patch.id)
        if (idx >= 0) {
          filteredNodes[idx] = { ...filteredNodes[idx], ...patch.changes }
        }
      }

      // Add
      filteredNodes.push(...diff.nodesAdded)
      filteredEdges.push(...diff.edgesAdded)

      return {
        graph: { ...state.graph, nodes: filteredNodes, edges: filteredEdges },
      }
    }),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleModule: (id) =>
    set((state) => {
      const next = new Set(state.expandedModules)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedModules: next }
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
