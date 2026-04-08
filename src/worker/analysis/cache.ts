import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import type {
  ProjectAnalysis,
  FunctionAnalysis,
  LayerAssignment,
  EdgeAnalysis,
} from '../../shared/types'

function cacheDir(rootDir: string): string {
  const hash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 12)
  return path.join(os.homedir(), '.grapharc', 'cache', hash, 'analysis')
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function safeId(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)
}

// ── Write lock (prevents race conditions on project.json) ─────

const writeLocks = new Map<string, Promise<void>>()

export async function withCacheLock<T>(rootDir: string, fn: () => T): Promise<T> {
  const prev = writeLocks.get(rootDir) ?? Promise.resolve()
  let resolve: () => void
  const next = new Promise<void>(r => { resolve = r })
  writeLocks.set(rootDir, next)
  await prev
  try {
    return fn()
  } finally {
    resolve!()
    // Clean up the map entry if this is still the latest lock
    if (writeLocks.get(rootDir) === next) {
      writeLocks.delete(rootDir)
    }
  }
}

// ── Project analysis ───────────────────────────────────────────

export function readProjectAnalysis(rootDir: string): { analysis: ProjectAnalysis; commitHash: string | null } | null {
  const file = path.join(cacheDir(rootDir), 'project.json')
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const commitHash = raw.commitHash ?? null
    // Remove commitHash from the object to get clean ProjectAnalysis
    const { commitHash: _, ...analysis } = raw
    return { analysis, commitHash }
  } catch {
    return null
  }
}

export function writeProjectAnalysis(rootDir: string, analysis: ProjectAnalysis, commitHash: string | null): void {
  const dir = cacheDir(rootDir)
  ensureDir(dir)
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ commitHash, ...analysis }, null, 2))
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
  const cached = readProjectAnalysis(rootDir)
  const project = cached?.analysis ?? null
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

// ── Component update helper ───────────────────────────────────

export function applyComponentUpdate(
  rootDir: string,
  layerName: string,
  oldComponentName: string,
  newComponent: { name: string; pseudocode: string; description: string; functions: string[]; output?: unknown },
  edgeUpdates?: Array<{ source: string; target: string; dataFormat: string; description: string }>
): ProjectAnalysis | null {
  const cached = readProjectAnalysis(rootDir)
  if (!cached) return null

  const analysis = cached.analysis
  const layer = analysis.layers.find((l) => l.name === layerName)
  if (!layer || !layer.components) return null

  const idx = layer.components.findIndex((c) => c.name === oldComponentName)
  if (idx >= 0) {
    layer.components[idx] = newComponent as any
  } else {
    layer.components.push(newComponent as any)
  }

  if (edgeUpdates) {
    layer.componentEdges = edgeUpdates
  }

  writeProjectAnalysis(rootDir, analysis, cached.commitHash)
  return analysis
}

export function writeManifest(
  rootDir: string,
  nodeIds: string[],
  edgeIds: string[]
): void {
  const dir = cacheDir(rootDir)
  ensureDir(dir)
  const manifestPath = path.join(dir, 'manifest.json')

  // Merge with existing manifest so incremental runs accumulate
  let existing: { nodes: Record<string, string>; edges: Record<string, string> } = { nodes: {}, edges: {} }
  try {
    existing = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
  } catch { /* no existing manifest */ }

  for (const id of nodeIds) existing.nodes[id] = safeId(id)
  for (const id of edgeIds) existing.edges[id] = safeId(id)

  fs.writeFileSync(manifestPath, JSON.stringify(existing, null, 2))
}
