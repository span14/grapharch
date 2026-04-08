import { useEffect } from 'react'
import { useAnalysisStore, type NodeAnalysis } from '../stores/analysisStore'
import type {
  AnalysisProgress,
  ProjectAnalysis,
  EdgeAnalysis,
  ComponentChatResponse,
} from '../../shared/types'

export function useAnalysisIPC(): void {
  const setProjectAnalysis = useAnalysisStore((s) => s.setProjectAnalysis)
  const setNodeAnalysis = useAnalysisStore((s) => s.setNodeAnalysis)
  const setEdgeAnalysis = useAnalysisStore((s) => s.setEdgeAnalysis)
  const setCacheProgress = useAnalysisStore((s) => s.setCacheProgress)
  const setProgress = useAnalysisStore((s) => s.setProgress)
  const setError = useAnalysisStore((s) => s.setError)
  const completeAnalysis = useAnalysisStore((s) => s.completeAnalysis)
  const addChatMessage = useAnalysisStore((s) => s.addChatMessage)
  const setChatLoading = useAnalysisStore((s) => s.setChatLoading)
  const updateComponent = useAnalysisStore((s) => s.updateComponent)

  useEffect(() => {
    const unsubs = [
      window.grapharc.onAnalysisProgress((data) => {
        setProgress(data as AnalysisProgress)
      }),
      window.grapharc.onAnalysisNode((data) => {
        const { nodeId, analysis } = data as { nodeId: string; analysis: NodeAnalysis }
        setNodeAnalysis(nodeId, analysis)
      }),
      window.grapharc.onAnalysisEdge((data) => {
        const { edgeId, analysis } = data as { edgeId: string; analysis: EdgeAnalysis }
        setEdgeAnalysis(edgeId, analysis)
      }),
      window.grapharc.onAnalysisProject((data) => {
        setProjectAnalysis(data as ProjectAnalysis)
      }),
      window.grapharc.onAnalysisError((data) => {
        const { target, error } = data as { target: string; error: string }
        setError(target, error)
      }),
      window.grapharc.onAnalysisComplete(() => {
        completeAnalysis()
      }),
      window.grapharc.onAnalysisCacheLoading((data) => {
        setCacheProgress(data as { total: number; done: number })
      }),
      window.grapharc.onComponentChatResponse((data) => {
        const resp = data as ComponentChatResponse
        setChatLoading(null)
        addChatMessage(resp.layerName, resp.componentName, {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: resp.text,
          timestamp: new Date().toISOString(),
          componentUpdate: resp.componentUpdate,
          edgeUpdates: resp.edgeUpdates,
        })
        if (resp.componentUpdate) {
          // Handle component rename: migrate chat history to new key
          if (resp.componentUpdate.name !== resp.componentName) {
            const store = useAnalysisStore.getState()
            const oldKey = `${resp.layerName}:${resp.componentName}`
            const newKey = `${resp.layerName}:${resp.componentUpdate.name}`
            const nextMessages = new Map(store.chatMessages)
            const existing = nextMessages.get(oldKey)
            if (existing) {
              nextMessages.delete(oldKey)
              nextMessages.set(newKey, existing)
              useAnalysisStore.setState({ chatMessages: nextMessages })
            }
          }
          updateComponent(resp.layerName, resp.componentName, resp.componentUpdate, resp.edgeUpdates)
        }
      }),
      window.grapharc.onComponentChatError((data) => {
        const { error } = data as { requestId: string; error: string }
        setChatLoading(null)
        // Show error in the UI via the general error mechanism
        setError('component-chat', error)
      }),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [setProjectAnalysis, setNodeAnalysis, setEdgeAnalysis, setCacheProgress, setProgress, setError, completeAnalysis, addChatMessage, setChatLoading, updateComponent])
}
