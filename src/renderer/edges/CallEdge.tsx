import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

const COUPLING_COLORS: Record<string, string> = {
  loose: '#22c55e',
  moderate: '#eab308',
  tight: '#ef4444',
}

export function CallEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath(props)
  const data = props.data as Record<string, unknown> | undefined
  const weight = (data?.weight as number) ?? 1
  const coupling = data?.coupling as string | undefined
  const passedType = data?.passedType as string | undefined

  const strokeWidth = Math.max(2, Math.min(1 + weight, 5))
  const color = coupling && coupling in COUPLING_COLORS
    ? COUPLING_COLORS[coupling]
    : '#3b82f6'

  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeWidth }}
        markerEnd="url(#arrow)"
      />
      {passedType && (
        <EdgeLabelRenderer>
          <div
            className="edge-type-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            title={passedType}
          >
            {passedType}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
