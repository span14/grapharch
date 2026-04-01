// src/worker/index.ts
//
// This runs as an Electron utilityProcess.
// It receives messages on process.parentPort and sends results back.
//
// Messages received:
//   { type: 'project:open', data: { rootDir: string } } -- full parse
//   { type: 'project:refresh' } -- re-parse current project
//
// Messages sent:
//   { type: 'worker:ready' }
//   { type: 'graph:ready', data: GraphData }
//   { type: 'parse:progress', data: { total, done } }
//   { type: 'parse:error', data: { file, error } }

import { initParser } from './symbols'
import { buildGraph } from './graph'
import { readCache, writeCache } from './cache'
import { startWatching, stopWatching } from './watcher'
import type { GraphData, WorkerMessage } from '../shared/types'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const LOG_FILE = path.join(os.homedir(), '.grapharc', 'worker.log')
function log(msg: string): void {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${msg}\n`)
  } catch { /* ignore */ }
}

let currentRootDir: string | null = null
let parserInitialized = false

function send(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

function graphsEqual(a: GraphData, b: GraphData): boolean {
  return (
    a.nodes.length === b.nodes.length &&
    a.edges.length === b.edges.length &&
    JSON.stringify(a.nodes) === JSON.stringify(b.nodes) &&
    JSON.stringify(a.edges) === JSON.stringify(b.edges)
  )
}

async function fullParse(rootDir: string): Promise<GraphData> {
  if (!parserInitialized) {
    await initParser()
    parserInitialized = true
  }
  send({ type: 'parse:progress', data: { total: 0, done: 0 } })
  return buildGraph(rootDir)
}

function setupWatcher(rootDir: string): void {
  startWatching(
    rootDir,
    // onChange: file added or modified
    (filePath: string) => {
      void handleFileChange(rootDir, filePath)
    },
    // onRemove: file deleted
    (filePath: string) => {
      void handleFileChange(rootDir, filePath)
    }
  )
}

async function handleFileChange(
  rootDir: string,
  _filePath: string
): Promise<void> {
  try {
    const graph = await buildGraph(rootDir)
    send({ type: 'graph:ready', data: graph })
    await writeCache(rootDir, graph)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    send({ type: 'parse:error', data: { file: _filePath, error: message } })
  }
}

process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const msg = e.data as { type: string; data?: Record<string, unknown> }

  if (msg.type === 'project:open') {
    const { rootDir } = msg.data as { rootDir: string }
    currentRootDir = rootDir

    // Stop any existing watcher from a previous project
    stopWatching()

    try {
      log(`project:open rootDir=${rootDir} __dirname=${__dirname}`)
      // 1. Check cache -- if it exists, send cached data immediately
      const cached = await readCache(rootDir)
      if (cached) {
        send({ type: 'graph:ready', data: cached })
      }

      // 2. Full parse
      const graph = await fullParse(rootDir)

      // 3. If cache was sent and fresh graph differs, send the update
      //    If no cache was sent, always send the fresh graph
      if (!cached || !graphsEqual(cached, graph)) {
        send({ type: 'graph:ready', data: graph })
      }

      // 4. Write fresh graph to cache
      await writeCache(rootDir, graph)

      // 5. Start file watcher
      setupWatcher(rootDir)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message + '\n' + (err as Error).stack : String(err)
      log(`ERROR: ${message}`)
      send({ type: 'parse:error', data: { file: rootDir, error: message } })
    }
  }

  if (msg.type === 'project:refresh') {
    if (currentRootDir) {
      try {
        const graph = await fullParse(currentRootDir)
        send({ type: 'graph:ready', data: graph })
        await writeCache(currentRootDir, graph)

        // Restart watcher in case it got into a bad state
        setupWatcher(currentRootDir)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        send({
          type: 'parse:error',
          data: { file: currentRootDir ?? '', error: message },
        })
      }
    }
  }
})

send({ type: 'worker:ready' })
