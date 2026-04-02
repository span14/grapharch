import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function ImportEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  const data = props.data as Record<string, unknown> | undefined
  const isUnresolved = data?.kind === 'import_unresolved'

  return (
    <BaseEdge
      path={path}
      style={{
        stroke: isUnresolved ? '#ef4444' : '#64748b',
        strokeWidth: 2,
        strokeDasharray: '6,4',
      }}
      markerEnd={isUnresolved ? 'url(#arrow-red)' : 'url(#arrow-gray)'}
    />
  )
}
