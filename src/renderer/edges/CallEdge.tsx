import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function CallEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  const weight = (props.data as Record<string, unknown>)?.weight as number ?? 1
  const strokeWidth = Math.min(1 + weight, 5)
  const color = weight >= 5 ? '#f59e0b' : '#3b82f6'

  return (
    <BaseEdge
      path={path}
      style={{ stroke: color, strokeWidth }}
    />
  )
}
