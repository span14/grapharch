import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ClassNodeData = {
  label: string
  methodCount: number
}

export function ClassNode({ data }: NodeProps<Node<ClassNodeData>>) {
  return (
    <div className="node node-class">
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.methodCount}m</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
