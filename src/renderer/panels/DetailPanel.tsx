import { useGraphStore } from '../stores/graphStore'
import {
  useAnalysisStore,
  isLayerAssignment,
  isFunctionAnalysis,
} from '../stores/analysisStore'

export function DetailPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const graph = useGraphStore((s) => s.graph)
  const nodeAnalyses = useAnalysisStore((s) => s.nodeAnalyses)
  const edgeAnalyses = useAnalysisStore((s) => s.edgeAnalyses)

  if (!selectedNodeId || !graph) return null

  const node = graph.nodes.find((n) => n.id === selectedNodeId)
  if (!node) return null

  const inbound = graph.edges.filter((e) => e.target === selectedNodeId)
  const outbound = graph.edges.filter((e) => e.source === selectedNodeId)

  const analysis = nodeAnalyses.get(selectedNodeId)
  const layer = analysis && isLayerAssignment(analysis) ? analysis : null
  const fnAnalysis = analysis && isFunctionAnalysis(analysis) ? analysis : null

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className={`detail-kind kind-${node.kind}`}>{node.kind}</span>
        <h3>{node.label}</h3>
      </div>

      {/* Layer assignment */}
      {layer && (
        <div className="detail-section">
          <h4>Layer</h4>
          <div className="detail-layer-badge">
            {layer.layer}
            <span className="detail-confidence">{Math.round(layer.confidence * 100)}%</span>
          </div>
          <p className="detail-reasoning">{layer.reasoning}</p>
        </div>
      )}

      {/* AI analysis */}
      {fnAnalysis && (
        <div className="detail-section">
          <h4>AI Analysis</h4>
          <p className="detail-summary">{fnAnalysis.summary}</p>

          <div className="detail-row">
            <span className="detail-key">Complexity</span>
            <span className={`detail-complexity-pill complexity-bg-${fnAnalysis.complexity}`}>
              {fnAnalysis.complexity}
            </span>
          </div>
          {fnAnalysis.complexityReason && (
            <p className="detail-reasoning">{fnAnalysis.complexityReason}</p>
          )}

          {fnAnalysis.sideEffects.length > 0 && (
            <div className="detail-row">
              <span className="detail-key">Side Effects</span>
              <span>{fnAnalysis.sideEffects.join(', ')}</span>
            </div>
          )}
        </div>
      )}

      {/* Parameters */}
      {fnAnalysis && fnAnalysis.parameters.length > 0 && (
        <div className="detail-section">
          <h4>Parameters</h4>
          {fnAnalysis.parameters.map((p) => (
            <div key={p.name} className="detail-param">
              <code className="detail-param-name">{p.name}</code>
              <span className="detail-param-type">{p.type}</span>
              {p.description && <span className="detail-param-desc">{p.description}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Return type */}
      {fnAnalysis?.returnType && (
        <div className="detail-section">
          <h4>Returns</h4>
          <code className="detail-return-type">{fnAnalysis.returnType}</code>
        </div>
      )}

      {/* Code preview */}
      {fnAnalysis?.codePreview && (
        <div className="detail-section">
          <h4>Code Preview</h4>
          <pre className="detail-code">{fnAnalysis.codePreview}</pre>
        </div>
      )}

      {/* Basic info */}
      <div className="detail-section">
        <h4>Info</h4>
        <div className="detail-row">
          <span className="detail-key">File</span>
          <span>{node.filePath}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Lines</span>
          <span>{node.lineRange[0]}&ndash;{node.lineRange[1]}</span>
        </div>
        {node.childCount != null && (
          <div className="detail-row">
            <span className="detail-key">Children</span>
            <span>{node.childCount}</span>
          </div>
        )}
      </div>

      {/* Inbound edges with data flow */}
      {inbound.length > 0 && (
        <div className="detail-section">
          <h4>Inbound ({inbound.length})</h4>
          {inbound.map((e) => {
            const ea = edgeAnalyses.get(e.id)
            return (
              <div key={e.id} className="detail-edge">
                <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
                <span>{e.source}</span>
                {ea && <div className="detail-edge-flow">{ea.dataFlow}</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Outbound edges with data flow */}
      {outbound.length > 0 && (
        <div className="detail-section">
          <h4>Outbound ({outbound.length})</h4>
          {outbound.map((e) => {
            const ea = edgeAnalyses.get(e.id)
            return (
              <div key={e.id} className="detail-edge">
                <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
                <span>{e.target}</span>
                {ea && <div className="detail-edge-flow">{ea.dataFlow}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
