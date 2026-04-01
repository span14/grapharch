import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ParameterInfo } from '../../shared/types'

export type FunctionNodeData = {
  label: string
  async?: boolean
  lineCount: number
  summary?: string
  complexity?: 'low' | 'medium' | 'high'
  parameters?: ParameterInfo[]
  returnType?: string
}

export function FunctionNode({ data }: NodeProps<Node<FunctionNodeData>>) {
  return (
    <div className="node node-fn-card">
      <Handle type="target" position={Position.Top} />
      <div className="fn-card-header">
        {data.complexity && (
          <span className={`complexity-dot complexity-${data.complexity}`} />
        )}
        <span className="fn-card-name">
          {data.async && <span className="badge">async</span>}
          {data.label}()
        </span>
        <span className="fn-card-lines">{data.lineCount}L</span>
      </div>
      {data.parameters && data.parameters.length > 0 && (
        <div className="fn-card-section">
          <span className="fn-card-label">IN</span>
          <div className="fn-card-params">
            {data.parameters.map((p) => (
              <div key={p.name} className="fn-card-param">
                <span className="fn-param-name">{p.name}:</span>
                <span className="fn-param-type">{p.type}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.returnType && (
        <div className="fn-card-section fn-card-out">
          <span className="fn-card-label">OUT</span>
          <span className="fn-param-type">{data.returnType}</span>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
