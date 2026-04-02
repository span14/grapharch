import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type LayerNodeData = {
  label: string
  color: string
  modules: string[]
  moduleCount: number
  onClick: () => void
  selected?: boolean
}

export function LayerNode({ data }: NodeProps<Node<LayerNodeData>>) {
  return (
    <div
      className={`node node-layer ${data.selected ? 'node-selected' : ''}`}
      style={{ borderColor: data.color, borderLeftColor: data.color, borderLeftWidth: 4 }}
      onClick={data.onClick}
    >
      <Handle type="target" position={Position.Top} />
      <div className="layer-header">
        <span className="layer-color-dot" style={{ backgroundColor: data.color }} />
        <span className="layer-name">{data.label}</span>
      </div>
      <div className="layer-modules">
        {data.modules.map((m) => (
          <div key={m} className="layer-module-item">{m}</div>
        ))}
      </div>
      <div className="layer-count">{data.moduleCount} modules</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
