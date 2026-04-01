import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function ImportEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  return (
    <BaseEdge
      path={path}
      style={{ strokeDasharray: '5,5', stroke: '#666' }}
    />
  )
}
