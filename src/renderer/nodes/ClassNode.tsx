import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ClassNodeData = {
  label: string
  methodCount: number
  summary?: string
  complexity?: 'low' | 'medium' | 'high'
  selected?: boolean
}

export function ClassNode({ data }: NodeProps<Node<ClassNodeData>>) {
  return (
    <div className={`node node-class ${data.selected ? 'node-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        {data.complexity && (
          <span className={`complexity-dot complexity-${data.complexity}`} title={data.complexity} />
        )}
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.methodCount}m</span>
      </div>
      {data.summary && <div className="node-summary" title={data.summary}>{data.summary}</div>}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
