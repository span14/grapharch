import { useGraphStore } from '../stores/graphStore'

const EDGE_KINDS = ['import', 'call', 'import_unresolved'] as const

export function FilterBar() {
  const graph = useGraphStore((s) => s.graph)
  const searchQuery = useGraphStore((s) => s.searchQuery)
  const visibleEdgeKinds = useGraphStore((s) => s.visibleEdgeKinds)
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery)
  const toggleEdgeKind = useGraphStore((s) => s.toggleEdgeKind)

  const moduleCount = graph ? graph.nodes.filter((n) => n.kind === 'module').length : 0
  const edgeCount = graph ? graph.edges.length : 0

  return (
    <div className="filter-bar">
      <input
        className="search-input"
        type="text"
        placeholder="Search nodes..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className="edge-toggles">
        {EDGE_KINDS.map((kind) => (
          <label key={kind} className="edge-toggle">
            <input
              type="checkbox"
              checked={visibleEdgeKinds.has(kind)}
              onChange={() => toggleEdgeKind(kind)}
            />
            {kind}
          </label>
        ))}
      </div>
      <div className="stats">
        {moduleCount} modules | {edgeCount} edges
      </div>
    </div>
  )
}
