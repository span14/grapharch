import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type {
  GraphNode,
  ProjectAnalysis,
  FunctionAnalysis,
  LayerAssignment,
  EdgeAnalysis,
} from '../../shared/types'
import { getNodeSource } from './sourceCollector'

function cacheDir(rootDir: string): string {
  const hash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 12)
  return path.join(os.homedir(), '.grapharc', 'cache', hash, 'analysis')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function safeId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 16)
}

// ── Source hashes for invalidation ─────────────────────────────

export function computeSourceHash(source: string): string {
  return crypto.createHash('sha256').update(source).digest('hex').slice(0, 16)
}

export function loadSourceHashes(rootDir: string): Record<string, string> {
  const file = path.join(cacheDir(rootDir), 'source-hashes.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveSourceHashes(rootDir: string, hashes: Record<string, string>): void {
  const dir = cacheDir(rootDir)
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, 'source-hashes.json'), JSON.stringify(hashes, null, 2))
}

export function findStaleNodes(
  nodes: GraphNode[],
  fileSources: Map<string, string>,
  cachedHashes: Record<string, string>
): GraphNode[] {
  return nodes.filter((node) => {
    const source = getNodeSource(node, fileSources)
    if (!source) return true
    const currentHash = computeSourceHash(source)
    return cachedHashes[node.id] !== currentHash
  })
}

// ── Project analysis ───────────────────────────────────────────

export function readProjectAnalysis(rootDir: string): ProjectAnalysis | null {
  const file = path.join(cacheDir(rootDir), 'project.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function writeProjectAnalysis(rootDir: string, analysis: ProjectAnalysis): void {
  const dir = cacheDir(rootDir)
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(analysis, null, 2))
}

// ── Node analysis ──────────────────────────────────────────────

export function readNodeAnalysis(
  rootDir: string,
  nodeId: string
): FunctionAnalysis | LayerAssignment | null {
  const file = path.join(cacheDir(rootDir), 'nodes', `${safeId(nodeId)}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function writeNodeAnalysis(
  rootDir: string,
  nodeId: string,
  analysis: FunctionAnalysis | LayerAssignment
): void {
  const dir = path.join(cacheDir(rootDir), 'nodes')
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, `${safeId(nodeId)}.json`), JSON.stringify(analysis, null, 2))
}

// ── Edge analysis ──────────────────────────────────────────────

export function readEdgeAnalysis(rootDir: string, edgeId: string): EdgeAnalysis | null {
  const file = path.join(cacheDir(rootDir), 'edges', `${safeId(edgeId)}.json`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

export function writeEdgeAnalysis(rootDir: string, edgeId: string, analysis: EdgeAnalysis): void {
  const dir = path.join(cacheDir(rootDir), 'edges')
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, `${safeId(edgeId)}.json`), JSON.stringify(analysis, null, 2))
}

// ── Bulk read for startup ──────────────────────────────────────

export function readAllCachedAnalysis(rootDir: string): {
  project: ProjectAnalysis | null
  nodes: Map<string, FunctionAnalysis | LayerAssignment>
  edges: Map<string, EdgeAnalysis>
} {
  const project = readProjectAnalysis(rootDir)
  const nodes = new Map<string, FunctionAnalysis | LayerAssignment>()
  const edges = new Map<string, EdgeAnalysis>()

  // Read node analyses — we need a reverse mapping from hash to nodeId
  // Since we hash the IDs, we store a manifest
  const manifestPath = path.join(cacheDir(rootDir), 'manifest.json')
  try {
    const manifest: { nodes: Record<string, string>; edges: Record<string, string> } =
      JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))

    for (const [nodeId, hash] of Object.entries(manifest.nodes)) {
      const file = path.join(cacheDir(rootDir), 'nodes', `${hash}.json`)
      try {
        nodes.set(nodeId, JSON.parse(fs.readFileSync(file, 'utf-8')))
      } catch { /* skip */ }
    }

    for (const [edgeId, hash] of Object.entries(manifest.edges)) {
      const file = path.join(cacheDir(rootDir), 'edges', `${hash}.json`)
      try {
        edges.set(edgeId, JSON.parse(fs.readFileSync(file, 'utf-8')))
      } catch { /* skip */ }
    }
  } catch {
    // No manifest — no cached analysis
  }

  return { project, nodes, edges }
}

export function writeManifest(
  rootDir: string,
  nodeIds: string[],
  edgeIds: string[]
): void {
  const dir = cacheDir(rootDir)
  ensureDir(dir)
  const manifest = {
    nodes: Object.fromEntries(nodeIds.map((id) => [id, safeId(id)])),
    edges: Object.fromEntries(edgeIds.map((id) => [id, safeId(id)])),
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
}
