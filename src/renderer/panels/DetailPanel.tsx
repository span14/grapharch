import { useGraphStore } from '../stores/graphStore'

export function DetailPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const graph = useGraphStore((s) => s.graph)

  if (!selectedNodeId || !graph) return null

  const node = graph.nodes.find((n) => n.id === selectedNodeId)
  if (!node) return null

  const inbound = graph.edges.filter((e) => e.target === selectedNodeId)
  const outbound = graph.edges.filter((e) => e.source === selectedNodeId)

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className={`detail-kind kind-${node.kind}`}>{node.kind}</span>
        <h3>{node.label}</h3>
      </div>

      <div className="detail-section">
        <h4>Info</h4>
        <div className="detail-row">
          <span className="detail-key">File</span>
          <span>{node.filePath}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Lines</span>
          <span>
            {node.lineRange[0]}&ndash;{node.lineRange[1]}
          </span>
        </div>
        {node.childCount != null && (
          <div className="detail-row">
            <span className="detail-key">Children</span>
            <span>{node.childCount}</span>
          </div>
        )}
      </div>

      {inbound.length > 0 && (
        <div className="detail-section">
          <h4>Inbound ({inbound.length})</h4>
          {inbound.map((e) => (
            <div key={e.id} className="detail-edge">
              <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
              <span>{e.source}</span>
            </div>
          ))}
        </div>
      )}

      {outbound.length > 0 && (
        <div className="detail-section">
          <h4>Outbound ({outbound.length})</h4>
          {outbound.map((e) => (
            <div key={e.id} className="detail-edge">
              <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
              <span>{e.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
