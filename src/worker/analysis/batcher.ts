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

/**
 * Estimate total API cost for an analysis run.
 */
export function estimateCost(
  nodes: GraphNode[],
  edges: GraphEdge[],
  fileSources: Map<string, string>,
  model: string
): { inputTokens: number; estimatedCostUsd: number } {
  let totalChars = 0

  // Module heads for layer analysis
  const modules = nodes.filter((n) => n.kind === 'module')
  for (const m of modules) {
    const source = fileSources.get(m.filePath) ?? ''
    totalChars += Math.min(source.length, 30 * 80) // ~30 lines
  }

  // Function sources
  const fns = nodes.filter((n) => n.kind !== 'module')
  for (const n of fns) {
    totalChars += getNodeSource(n, fileSources).length
  }

  // Edge sources (counted twice for source+target)
  totalChars += edges.length * 500 // rough average

  const inputTokens = Math.ceil(totalChars / 4)

  // Pricing per million tokens (input) — rough estimates
  const pricing: Record<string, number> = {
    'claude-sonnet-4-20250514': 3,
    'claude-opus-4-20250514': 15,
    'claude-haiku-4-5-20251001': 0.8,
  }
  const pricePerMTok = pricing[model] ?? 3
  const estimatedCostUsd = (inputTokens / 1_000_000) * pricePerMTok * 1.5 // 1.5x for output

  return { inputTokens, estimatedCostUsd }
}
