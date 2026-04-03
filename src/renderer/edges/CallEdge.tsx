import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

const COUPLING_COLORS: Record<string, string> = {
  loose: '#22c55e',
  moderate: '#eab308',
  tight: '#ef4444',
}

const COUPLING_MARKERS: Record<string, string> = {
  loose: 'url(#arrow-green)',
  moderate: 'url(#arrow-yellow)',
  tight: 'url(#arrow-red)',
}

function formatPassedTypes(types: string[]): { label: string; full: string } {
  if (types.length === 0) return { label: '', full: '' }
  if (types.length <= 2) return { label: types.join(' | '), full: types.join(', ') }
  return { label: `${types[0]} | ${types[1]} +${types.length - 2}`, full: types.join(', ') }
}

export function CallEdge(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath(props)
  const data = props.data as Record<string, unknown> | undefined
  const weight = (data?.weight as number) ?? 1
  const coupling = data?.coupling as string | undefined
  const passedType = data?.passedType as string | undefined
  const passedTypes = data?.passedTypes as string[] | undefined

  const strokeWidth = Math.max(2, Math.min(1 + weight, 5))
  const color = coupling && coupling in COUPLING_COLORS
    ? COUPLING_COLORS[coupling]
    : '#3b82f6'

  // Determine label: description (interpreted) vs raw types
  let labelText: string | undefined
  let tooltipText: string | undefined
  let isDescription = false
  if (passedType && passedTypes && passedTypes.length > 0) {
    // AI-interpreted edge: description as label, data formats as tooltip
    labelText = passedType
    tooltipText = passedTypes.join(', ')
    isDescription = true
  } else if (passedTypes && passedTypes.length > 0) {
    const fmt = formatPassedTypes(passedTypes)
    labelText = fmt.label
    tooltipText = fmt.full
  } else if (passedType) {
    labelText = passedType
    tooltipText = passedType
  }

  return (
    <>
      <BaseEdge
        path={path}
        style={{ stroke: color, strokeWidth }}
        markerEnd={coupling && coupling in COUPLING_MARKERS ? COUPLING_MARKERS[coupling] : 'url(#arrow)'}
      />
      {labelText && (
        <EdgeLabelRenderer>
          <div
            className={isDescription ? 'edge-desc-label' : 'edge-type-label'}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            title={tooltipText}
          >
            {labelText}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}
