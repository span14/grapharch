import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type FunctionNodeData = {
  label: string
  async?: boolean
  lineCount: number
}

export function FunctionNode({ data }: NodeProps<Node<FunctionNodeData>>) {
  return (
    <div className="node node-function">
      <Handle type="target" position={Position.Top} />
      <span className="node-label">
        {data.async && <span className="badge">async</span>}
        {data.label}
      </span>
      <span className="node-lines">{data.lineCount}L</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
