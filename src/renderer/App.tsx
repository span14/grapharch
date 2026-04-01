import { useGraphIPC } from './hooks/useGraph'
import { useGraphStore } from './stores/graphStore'
import { Canvas } from './Canvas'
import './styles.css'

function App() {
  useGraphIPC()
  const graph = useGraphStore((s) => s.graph)
  const loading = useGraphStore((s) => s.loading)

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
      </div>
    )
  }

  return (
    <div className="app">
      <div className="canvas-container">
        <Canvas />
      </div>
    </div>
  )
}

export default App
