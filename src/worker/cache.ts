import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import type { GraphData } from '../shared/types'

function cacheDir(rootDir: string): string {
  const hash = crypto
    .createHash('sha256')
    .update(rootDir)
    .digest('hex')
    .slice(0, 12)
  return path.join(os.homedir(), '.grapharc', 'cache', hash)
}

export async function readCache(rootDir: string): Promise<GraphData | null> {
  try {
    const dir = cacheDir(rootDir)
    const raw = await fs.readFile(path.join(dir, 'graph.json'), 'utf-8')
    return JSON.parse(raw) as GraphData
  } catch {
    return null
  }
}

export async function writeCache(
  rootDir: string,
  graph: GraphData
): Promise<void> {
  const dir = cacheDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(graph))
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
