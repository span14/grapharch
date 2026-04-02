import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ModuleNodeData = {
  label: string
  childCount: number
  expanded: boolean
  onToggle: () => void
  layerName?: string
  layerColor?: string
  selected?: boolean
}

export function ModuleNode({ data }: NodeProps<Node<ModuleNodeData>>) {
  return (
    <div
      className={`node node-module ${data.expanded ? 'expanded' : ''} ${data.selected ? 'node-selected' : ''}`}
      style={data.layerColor ? { borderLeftColor: data.layerColor, borderLeftWidth: 4 } : undefined}
    >
      <Handle type="target" position={Position.Top} />
      <div className="node-header" onDoubleClick={data.onToggle}>
        <span className="node-icon" onClick={(e) => { e.stopPropagation(); data.onToggle(); }}>{data.expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.childCount}</span>
      </div>
      {data.layerName && (
        <div className="node-layer-label" style={{ color: data.layerColor }}>
          {data.layerName}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
