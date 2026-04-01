import fs from 'node:fs/promises'
import path from 'node:path'
import type { GraphData, GraphEdge, GraphNode } from '../shared/types'
import { discoverPythonFiles } from './discovery'
import { extractSymbols } from './symbols'
import { resolveEdges } from './edges'

/**
 * Compute module-level rollup edges by aggregating symbol-level edges.
 *
 * For each edge between symbols in different modules, we count the
 * cross-module relationship and create aggregated module-to-module edges
 * with a `weight` field indicating the number of underlying symbol edges.
 */
export function computeModuleRollups(
  allNodes: GraphNode[],
  edges: GraphEdge[]
): GraphEdge[] {
  // Build a map from each non-module node id to its module (filePath)
  const nodeToModule = new Map<string, string>()
  for (const node of allNodes) {
    if (node.kind === 'module') {
      nodeToModule.set(node.id, node.filePath)
    } else {
      nodeToModule.set(node.id, node.filePath)
    }
  }

  // Count cross-module relationships
  const modulePairCounts = new Map<string, number>()

  for (const edge of edges) {
    const sourceModule = nodeToModule.get(edge.source)
    const targetModule = nodeToModule.get(edge.target)

    if (!sourceModule || !targetModule) continue
    if (sourceModule === targetModule) continue

    const key = `${sourceModule}|${targetModule}`
    modulePairCounts.set(key, (modulePairCounts.get(key) ?? 0) + 1)
  }

  // Create aggregated module-to-module edges
  const rollupEdges: GraphEdge[] = []
  let rollupCounter = 0

  for (const [key, weight] of modulePairCounts) {
    const [sourceModule, targetModule] = key.split('|')
    rollupCounter++
    rollupEdges.push({
      id: `edge-rollup-${rollupCounter}`,
      source: sourceModule,
      target: targetModule,
      kind: 'import',
      weight,
    })
  }

  return rollupEdges
}

export interface BuildGraphResult {
  graph: GraphData
  fileSources: Map<string, string>
}

export async function buildGraphIncremental(
  rootDir: string,
  cachedGraph: GraphData,
  changedFiles: string[],
): Promise<BuildGraphResult> {
  const changedSet = new Set(changedFiles)
  const allNodes: GraphNode[] = []
  const fileSources = new Map<string, string>()

  // Discover all current .py files
  const files = await discoverPythonFiles(rootDir)

  for (const file of files) {
    const rel = path.relative(rootDir, file)

    if (changedSet.has(rel)) {
      // Changed file: re-read and re-parse
      const source = await fs.readFile(file, 'utf-8')
      fileSources.set(rel, source)
      allNodes.push(...extractSymbols(source, rel))
    } else {
      // Unchanged file: keep cached nodes, read source for fileSources map
      const cachedNodes = cachedGraph.nodes.filter((n) => n.filePath === rel)
      allNodes.push(...cachedNodes)
      const source = await fs.readFile(file, 'utf-8')
      fileSources.set(rel, source)
    }
  }

  // Re-resolve all edges (edges can span files, so we need full resolution)
  const edges = resolveEdges(allNodes, fileSources, rootDir)
  const moduleEdges = computeModuleRollups(allNodes, edges)

  return {
    graph: {
      nodes: allNodes,
      edges: [...edges, ...moduleEdges],
      metadata: {
        rootDir,
        fileCount: files.length,
        parsedAt: new Date().toISOString(),
      },
    },
    fileSources,
  }
}

/**
 * Read all Python file sources without parsing.
 * Used when the graph cache is current but we need fileSources for analysis.
 */
export async function readFileSources(rootDir: string): Promise<Map<string, string>> {
  const files = await discoverPythonFiles(rootDir)
  const fileSources = new Map<string, string>()
  for (const file of files) {
    const rel = path.relative(rootDir, file)
    const source = await fs.readFile(file, 'utf-8')
    fileSources.set(rel, source)
  }
  return fileSources
}

export async function buildGraph(rootDir: string): Promise<BuildGraphResult> {
  const files = await discoverPythonFiles(rootDir)
  const allNodes: GraphNode[] = []
  const fileSources = new Map<string, string>()

  for (const file of files) {
    const rel = path.relative(rootDir, file)
    const source = await fs.readFile(file, 'utf-8')
    fileSources.set(rel, source)
    allNodes.push(...extractSymbols(source, rel))
  }

  const edges = resolveEdges(allNodes, fileSources, rootDir)

  // Compute module-level rollup edges
  const moduleEdges = computeModuleRollups(allNodes, edges)

  return {
    graph: {
      nodes: allNodes,
      edges: [...edges, ...moduleEdges],
      metadata: {
        rootDir,
        fileCount: files.length,
        parsedAt: new Date().toISOString(),
      },
    },
    fileSources,
  }
}
