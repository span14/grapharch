import { useEffect } from 'react'
import { useAnalysisStore, type NodeAnalysis } from '../stores/analysisStore'
import type {
  AnalysisProgress,
  ProjectAnalysis,
  EdgeAnalysis,
} from '../../shared/types'

export function useAnalysisIPC(): void {
  const setProjectAnalysis = useAnalysisStore((s) => s.setProjectAnalysis)
  const setNodeAnalysis = useAnalysisStore((s) => s.setNodeAnalysis)
  const setEdgeAnalysis = useAnalysisStore((s) => s.setEdgeAnalysis)
  const setCacheProgress = useAnalysisStore((s) => s.setCacheProgress)
  const setProgress = useAnalysisStore((s) => s.setProgress)
  const setError = useAnalysisStore((s) => s.setError)
  const completeAnalysis = useAnalysisStore((s) => s.completeAnalysis)

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
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [setProjectAnalysis, setNodeAnalysis, setEdgeAnalysis, setCacheProgress, setProgress, setError, completeAnalysis])
}
