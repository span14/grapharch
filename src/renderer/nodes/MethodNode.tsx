import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type MethodNodeData = {
  label: string
  selected?: boolean
}

export function MethodNode({ data }: NodeProps<Node<MethodNodeData>>) {
  return (
    <div className={`node node-method ${data.selected ? 'node-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <span className="node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
