import { useGraphIPC } from './hooks/useGraph'
import { useAnalysisIPC } from './hooks/useAnalysis'
import { useGraphStore } from './stores/graphStore'
import { useAnalysisStore } from './stores/analysisStore'
import { ReactFlowProvider } from '@xyflow/react'
import { Canvas } from './Canvas'
import { DetailPanel } from './panels/DetailPanel'
import { FilterBar } from './panels/FilterBar'
import { AnalysisPanel } from './panels/AnalysisPanel'
import './styles.css'

function LoadingOverlay() {
  const cacheProgress = useAnalysisStore((s) => s.cacheProgress)
  const pct = cacheProgress && cacheProgress.total > 0
    ? Math.round((cacheProgress.done / cacheProgress.total) * 100)
    : 0

  return (
    <div className="loading-overlay">
      <div className="loading-content">
        <div className="loading-spinner" />
        <div className="loading-text">Loading project analysis...</div>
        {cacheProgress && (
          <div className="loading-progress">
            <div className="loading-bar">
              <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="loading-detail">{cacheProgress.done} / {cacheProgress.total} items</div>
          </div>
        )}
      </div>
    </div>
  )
}

function App() {
  useGraphIPC()
  useAnalysisIPC()
  const graph = useGraphStore((s) => s.graph)
  const loading = useGraphStore((s) => s.loading)
  const error = useGraphStore((s) => s.error)
  const analysisStatus = useAnalysisStore((s) => s.status)

  const handleOpen = async () => {
    await window.grapharc.openFolderDialog()
  }

  if (!graph) {
    return (
      <div className="welcome">
        <h1>GraphArc</h1>
        <p>Open a Python project to visualize its architecture</p>
        <button onClick={handleOpen}>Open Project Folder...</button>
        {loading && <p>Parsing...</p>}
        {error && <p style={{ color: '#ef4444', maxWidth: 600, fontSize: 13, whiteSpace: 'pre-wrap' }}>{error}</p>}
      </div>
    )
  }

  if (analysisStatus === 'loading') {
    return (
      <div className="app">
        <AnalysisPanel />
        <div className="main-area">
          <LoadingOverlay />
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <AnalysisPanel />
      <div className="main-area">
        <FilterBar />
        <div className="canvas-container">
          <ReactFlowProvider>
            <Canvas />
          </ReactFlowProvider>
        </div>
      </div>
      <DetailPanel />
    </div>
  )
}

export default App
