import type { GraphNode, GraphEdge } from '../../shared/types'
import { getNodeSource } from './sourceCollector'

/**
 * Group nodes into batches that fit within a token budget.
 * Estimates tokens as source_length / 4 (rough char-to-token ratio).
 */
export function batchNodes(
  nodes: GraphNode[],
  fileSources: Map<string, string>,
  maxTokensPerBatch = 12_000
): GraphNode[][] {
  const batches: GraphNode[][] = []
  let current: GraphNode[] = []
  let currentTokens = 0

  for (const node of nodes) {
    const source = getNodeSource(node, fileSources)
    const estimatedTokens = Math.ceil(source.length / 4)

    if (currentTokens + estimatedTokens > maxTokensPerBatch && current.length > 0) {
      batches.push(current)
      current = []
      currentTokens = 0
    }

    current.push(node)
    currentTokens += estimatedTokens
  }

  if (current.length > 0) batches.push(current)
  return batches
}

/**
 * Group edges with their source/target nodes into batches.
 */
export function batchEdges(
  edges: GraphEdge[],
  nodeMap: Map<string, GraphNode>,
  fileSources: Map<string, string>,
  maxTokensPerBatch = 25_000
): Array<{ edge: GraphEdge; sourceNode: GraphNode; targetNode: GraphNode }>[] {
  type EdgeWithNodes = { edge: GraphEdge; sourceNode: GraphNode; targetNode: GraphNode }
  const batches: EdgeWithNodes[][] = []
  let current: EdgeWithNodes[] = []
  let currentTokens = 0

  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (!sourceNode || !targetNode) continue

    const srcSource = getNodeSource(sourceNode, fileSources)
    const tgtSource = getNodeSource(targetNode, fileSources)
    const estimatedTokens = Math.ceil((srcSource.length + tgtSource.length) / 4)

    if (currentTokens + estimatedTokens > maxTokensPerBatch && current.length > 0) {
      batches.push(current)
      current = []
      currentTokens = 0
    }

    current.push({ edge, sourceNode, targetNode })
    currentTokens += estimatedTokens
  }

  if (current.length > 0) batches.push(current)
  return batches
}

