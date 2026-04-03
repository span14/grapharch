import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ComponentNodeData = {
  label: string
  description: string
  pseudocode: string
  functionCount: number
  selected?: boolean
}

export function ComponentNode({ data }: NodeProps<Node<ComponentNodeData>>) {
  return (
    <div className={`node node-component ${data.selected ? 'node-selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="component-header">
        <span className="component-name">{data.label}</span>
        <span className="component-count">{data.functionCount} fn</span>
      </div>
      <div className="component-desc">{data.description}</div>
      <div className="component-code">
        <pre className="component-code-pre">{data.pseudocode}</pre>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
