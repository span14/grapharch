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
import type { WorkerMessage } from '../shared/types'

let currentRootDir: string | null = null
let parserInitialized = false

function send(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const msg = e.data as { type: string; data?: Record<string, unknown> }

  if (msg.type === 'project:open') {
    const { rootDir } = msg.data as { rootDir: string }
    currentRootDir = rootDir
    try {
      if (!parserInitialized) {
        await initParser()
        parserInitialized = true
      }
      send({ type: 'parse:progress', data: { total: 0, done: 0 } })
      const graph = await buildGraph(rootDir)
      send({ type: 'graph:ready', data: graph })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      send({ type: 'parse:error', data: { file: rootDir, error: message } })
    }
  }

  if (msg.type === 'project:refresh') {
    if (currentRootDir) {
      try {
        const graph = await buildGraph(currentRootDir)
        send({ type: 'graph:ready', data: graph })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        send({ type: 'parse:error', data: { file: currentRootDir ?? '', error: message } })
      }
    }
  }
})

send({ type: 'worker:ready' })
