import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import type { GraphData } from '../shared/types'

export interface CachedGraph {
  commitHash: string | null
  graph: GraphData
}

function cacheDir(rootDir: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(rootDir)
    .digest('hex')
    .slice(0, 12)
  return path.join(os.homedir(), '.grapharc', 'cache', hash)
}

export async function readCache(rootDir: string): Promise<CachedGraph | null> {
  try {
    const dir = cacheDir(rootDir)
    const raw = await fs.readFile(path.join(dir, 'graph.json'), 'utf-8')
    const data = JSON.parse(raw)
    // New format: { commitHash, graph }
    if ('commitHash' in data && 'graph' in data) {
      return { commitHash: data.commitHash, graph: data.graph as GraphData }
    }
    // Old format: raw GraphData with nodes/edges/metadata at top level
    if ('nodes' in data && 'edges' in data && 'metadata' in data) {
      return { commitHash: null, graph: data as GraphData }
    }
    return null
  } catch {
    return null
  }
}

export async function writeCache(
  rootDir: string,
  graph: GraphData,
  commitHash: string | null
): Promise<void> {
  const dir = cacheDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'graph.json'),
    JSON.stringify({ commitHash, graph })
  )
}

export async function readLayoutOverrides(
  rootDir: string
): Promise<Record<string, { x: number; y: number }>> {
  try {
    const dir = cacheDir(rootDir)
    const raw = await fs.readFile(
      path.join(dir, 'layout-overrides.json'),
      'utf-8'
    )
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function writeLayoutOverrides(
  rootDir: string,
  overrides: Record<string, { x: number; y: number }>
): Promise<void> {
  const dir = cacheDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, 'layout-overrides.json'),
    JSON.stringify(overrides)
  )
}
