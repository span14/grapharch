import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ModuleNodeData = {
  label: string
  childCount: number
  expanded: boolean
  onToggle: () => void
}

export function ModuleNode({ data }: NodeProps<Node<ModuleNodeData>>) {
  return (
    <div className={`node node-module ${data.expanded ? 'expanded' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header" onDoubleClick={data.onToggle}>
        <span className="node-icon">{data.expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.childCount}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
