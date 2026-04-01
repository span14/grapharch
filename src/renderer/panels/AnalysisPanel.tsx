import { useAnalysisStore } from '../stores/analysisStore'
import { useGraphStore } from '../stores/graphStore'

const MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Sonnet (balanced)' },
  { id: 'claude-opus-4-20250514', label: 'Opus (deepest)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku (fast)' },
]

export function AnalysisPanel() {
  const graph = useGraphStore((s) => s.graph)
  const status = useAnalysisStore((s) => s.status)
  const progress = useAnalysisStore((s) => s.progress)
  const error = useAnalysisStore((s) => s.error)
  const projectAnalysis = useAnalysisStore((s) => s.projectAnalysis)
  const selectedModel = useAnalysisStore((s) => s.selectedModel)
  const setSelectedModel = useAnalysisStore((s) => s.setSelectedModel)
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis)

  const handleAnalyze = () => {
    startAnalysis()
    window.grapharc.startAnalysis(selectedModel)
  }

  const handleCancel = () => {
    window.grapharc.cancelAnalysis()
  }

  if (!graph) return null

  return (
    <div className="analysis-panel">
      <h3>AI Analysis</h3>

      {/* Model selector */}
      <div className="analysis-section">
        <label className="analysis-label">Model</label>
        <select
          className="analysis-select"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={status === 'running'}
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      {/* Action button */}
      <div className="analysis-section">
        {status === 'running' ? (
          <button className="analysis-btn cancel" onClick={handleCancel}>
            Cancel Analysis
          </button>
        ) : (
          <button
            className="analysis-btn"
            onClick={handleAnalyze}
            disabled={!graph}
          >
            {projectAnalysis ? 'Re-analyze' : 'Analyze Architecture'}
          </button>
        )}
      </div>

      {/* Progress */}
      {status === 'running' && progress && (
        <div className="analysis-section">
          <div className="analysis-progress-label">
            {progress.phase === 'layers' && 'Analyzing layers...'}
            {progress.phase === 'functions' && `Functions ${progress.done}/${progress.total}`}
            {progress.phase === 'edges' && `Edges ${progress.done}/${progress.total}`}
          </div>
          <div className="analysis-progress-bar">
            <div
              className="analysis-progress-fill"
              style={{ width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="analysis-error">{error}</div>
      )}

      {/* Project summary */}
      {projectAnalysis && (
        <>
          <div className="analysis-section">
            <h4>Summary</h4>
            <p className="analysis-summary">{projectAnalysis.summary}</p>
          </div>

          {projectAnalysis.patterns.length > 0 && (
            <div className="analysis-section">
              <h4>Patterns</h4>
              <div className="analysis-patterns">
                {projectAnalysis.patterns.map((p, i) => (
                  <span key={i} className="analysis-pattern-tag">{p}</span>
                ))}
              </div>
            </div>
          )}

          {/* Layer legend */}
          <div className="analysis-section">
            <h4>Layers</h4>
            <div className="analysis-layers">
              {projectAnalysis.layers.map((layer) => (
                <div key={layer.name} className="analysis-layer-row">
                  <span
                    className="analysis-layer-dot"
                    style={{ backgroundColor: layer.color }}
                  />
                  <span className="analysis-layer-name">{layer.name}</span>
                  <span className="analysis-layer-count">{layer.modules.length}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
