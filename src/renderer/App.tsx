import { Component, type ReactNode } from 'react'
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

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ef4444' }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 12 }}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

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
          <ErrorBoundary>
            <ReactFlowProvider>
              <Canvas />
            </ReactFlowProvider>
          </ErrorBoundary>
        </div>
      </div>
      <ErrorBoundary>
        <DetailPanel />
      </ErrorBoundary>
    </div>
  )
}

export default App
