import { useEffect } from 'react'
import { useGraphStore } from '../stores/graphStore'
import type { GraphData, GraphDiff } from '../../shared/types'

declare global {
  interface Window {
    grapharc: {
      openProject: (rootDir: string) => Promise<void>
      refreshProject: () => Promise<void>
      openFolderDialog: () => Promise<string | null>
      onGraphReady: (cb: (data: GraphData) => void) => () => void
      onGraphDiff: (cb: (data: GraphDiff) => void) => () => void
      onParseProgress: (cb: (data: { total: number; done: number }) => void) => () => void
      onParseError: (cb: (data: { file: string; error: string }) => void) => () => void
      // Analysis
      startAnalysis: (model?: string) => Promise<void>
      cancelAnalysis: () => Promise<void>
      onAnalysisProgress: (cb: (data: unknown) => void) => () => void
      onAnalysisNode: (cb: (data: unknown) => void) => () => void
      onAnalysisEdge: (cb: (data: unknown) => void) => () => void
      onAnalysisProject: (cb: (data: unknown) => void) => () => void
      onAnalysisError: (cb: (data: unknown) => void) => () => void
      onAnalysisComplete: (cb: () => void) => () => void
      onAnalysisCacheLoading: (cb: (data: unknown) => void) => () => void
    }
  }
}

export function useGraphIPC(): void {
  const setGraph = useGraphStore((s) => s.setGraph)
  const applyDiff = useGraphStore((s) => s.applyDiff)
  const setLoading = useGraphStore((s) => s.setLoading)
  const setError = useGraphStore((s) => s.setError)

  useEffect(() => {
    const unsubs = [
      window.grapharc.onGraphReady((data) => setGraph(data)),
      window.grapharc.onGraphDiff((data) => applyDiff(data)),
      window.grapharc.onParseProgress(() => setLoading(true)),
      window.grapharc.onParseError((data) => setError(data.error)),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [setGraph, applyDiff, setLoading, setError])
}
