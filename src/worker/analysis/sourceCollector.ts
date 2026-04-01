import type { GraphNode } from '../../shared/types'

/**
 * Extract the full source code for a graph node using its lineRange.
 */
export function getNodeSource(
  node: GraphNode,
  fileSources: Map<string, string>
): string {
  const source = fileSources.get(node.filePath)
  if (!source) return ''
  const lines = source.split('\n')
  const [start, end] = node.lineRange
  return lines.slice(start - 1, end).join('\n')
}

/**
 * Extract a code preview (first N lines) for display in the UI.
 */
export function getCodePreview(
  node: GraphNode,
  fileSources: Map<string, string>,
  maxLines = 20
): string {
  const full = getNodeSource(node, fileSources)
  const lines = full.split('\n')
  if (lines.length <= maxLines) return full
  return lines.slice(0, maxLines).join('\n') + '\n# ...'
}

/**
 * Extract the first N lines of a file (for module-level context in prompts).
 */
export function getFileHead(
  filePath: string,
  fileSources: Map<string, string>,
  maxLines = 30
): string {
  const source = fileSources.get(filePath)
  if (!source) return ''
  const lines = source.split('\n')
  if (lines.length <= maxLines) return source
  return lines.slice(0, maxLines).join('\n') + '\n# ...'
}
