import { useGraphIPC } from './hooks/useGraph'
import { useGraphStore } from './stores/graphStore'
import { Canvas } from './Canvas'
import { DetailPanel } from './panels/DetailPanel'
import { FilterBar } from './panels/FilterBar'
import './styles.css'

function App() {
  useGraphIPC()
  const graph = useGraphStore((s) => s.graph)
  const loading = useGraphStore((s) => s.loading)
  const error = useGraphStore((s) => s.error)

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

  return (
    <div className="app">
      <div className="main-area">
        <FilterBar />
        <div className="canvas-container">
          <Canvas />
        </div>
      </div>
      <DetailPanel />
    </div>
  )
}

export default App
