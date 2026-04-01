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
import { buildGraph, buildGraphIncremental, readFileSources } from './graph'
import { isGitRepo, getHeadCommit, getChangedFiles } from './git'
import { readCache, writeCache } from './cache'
import { startWatching, stopWatching } from './watcher'
import { AnalysisPipeline } from './analysis'
import { readProjectAnalysis, readAllCachedAnalysis } from './analysis/cache'
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
let lastFileSources: Map<string, string> | null = null
let lastGraph: GraphData | null = null
let currentAnalysis: AnalysisPipeline | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function send(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

function graphsEqual(a: GraphData, b: GraphData): boolean {
  if (a.nodes.length !== b.nodes.length) return false
  if (a.edges.length !== b.edges.length) return false
  if (a.metadata.parsedAt !== b.metadata.parsedAt) return false
  // Check node IDs match (fast proxy for structural equality)
  const aIds = new Set(a.nodes.map((n) => n.id))
  for (const n of b.nodes) {
    if (!aIds.has(n.id)) return false
  }
  return true
}

async function fullParse(rootDir: string): Promise<GraphData> {
  if (!parserInitialized) {
    await initParser()
    parserInitialized = true
  }
  send({ type: 'parse:progress', data: { total: 0, done: 0 } })
  const result = await buildGraph(rootDir)
  lastFileSources = result.fileSources
  lastGraph = result.graph
  return result.graph
}

function setupWatcher(rootDir: string): void {
  startWatching(
    rootDir,
    (filePath: string) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void handleFileChange(rootDir, filePath), 300)
    },
    (filePath: string) => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void handleFileChange(rootDir, filePath), 300)
    }
  )
}

async function handleFileChange(
  rootDir: string,
  _filePath: string
): Promise<void> {
  // Cancel any running analysis — graph is changing
  if (currentAnalysis) {
    currentAnalysis.cancel()
    currentAnalysis = null
  }

  try {
    const result = await buildGraph(rootDir)
    lastFileSources = result.fileSources
    lastGraph = result.graph
    send({ type: 'graph:ready', data: result.graph })
    const commitHash = isGitRepo(rootDir) ? getHeadCommit(rootDir) : null
    await writeCache(rootDir, result.graph, commitHash)
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
    stopWatching()

    try {
      log(`project:open rootDir=${rootDir}`)
      const cachedResult = await readCache(rootDir)

      // Send cached graph immediately if available
      if (cachedResult) {
        send({ type: 'graph:ready', data: cachedResult.graph })
      }

      let graph: GraphData
      const useGit = isGitRepo(rootDir)
      const currentCommit = useGit ? getHeadCommit(rootDir) : null

      if (
        cachedResult &&
        useGit &&
        currentCommit &&
        cachedResult.commitHash &&
        cachedResult.commitHash === currentCommit
      ) {
        log(`Same commit ${currentCommit.slice(0, 8)}, using cache`)
        graph = cachedResult.graph
        lastGraph = graph
        lastFileSources = await readFileSources(rootDir)
      } else if (
        cachedResult &&
        useGit &&
        currentCommit &&
        cachedResult.commitHash
      ) {
        // Different commit -- incremental parse
        const changedFiles = getChangedFiles(rootDir, cachedResult.commitHash, currentCommit)
        log(`Incremental parse: ${changedFiles.length} changed files since ${cachedResult.commitHash.slice(0, 8)}`)

        if (changedFiles.length === 0) {
          graph = cachedResult.graph
          lastGraph = graph
          lastFileSources = await readFileSources(rootDir)
        } else {
          const result = await buildGraphIncremental(rootDir, cachedResult.graph, changedFiles)
          lastFileSources = result.fileSources
          lastGraph = result.graph
          graph = result.graph
        }

        if (!cachedResult || !graphsEqual(cachedResult.graph, graph)) {
          send({ type: 'graph:ready', data: graph })
        }
        await writeCache(rootDir, graph, currentCommit)
      } else {
        // No cache, not a git repo, or no commit hash -- full parse
        const result = await fullParse(rootDir)
        graph = result

        if (!cachedResult || !graphsEqual(cachedResult.graph, graph)) {
          send({ type: 'graph:ready', data: graph })
        }
        await writeCache(rootDir, graph, currentCommit)
      }

      setupWatcher(rootDir)

      // Load cached analysis results if available
      const cachedAnalysis = readAllCachedAnalysis(rootDir)
      if (cachedAnalysis.project) {
        send({ type: 'analysis:project', data: cachedAnalysis.project })
      }
      for (const [nodeId, analysis] of cachedAnalysis.nodes) {
        send({ type: 'analysis:node', data: { nodeId, analysis } })
      }
      for (const [edgeId, analysis] of cachedAnalysis.edges) {
        send({ type: 'analysis:edge', data: { edgeId, analysis } })
      }
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
        const commitHash = isGitRepo(currentRootDir) ? getHeadCommit(currentRootDir) : null
        await writeCache(currentRootDir, graph, commitHash)

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

  if (msg.type === 'analysis:start') {
    if (!lastGraph || !lastFileSources) {
      send({ type: 'analysis:error', data: { target: 'project', error: 'No project loaded. Open a project first.' } })
      return
    }

    // Cancel any running analysis
    currentAnalysis?.cancel()

    const model = (msg.data as { model?: string })?.model

    // Determine changed files for incremental analysis
    let changedFiles: string[] | null = null
    if (currentRootDir && isGitRepo(currentRootDir)) {
      const cached = readProjectAnalysis(currentRootDir)
      const currentCommit = getHeadCommit(currentRootDir)
      if (cached && cached.commitHash && currentCommit && cached.commitHash !== currentCommit) {
        changedFiles = getChangedFiles(currentRootDir, cached.commitHash, currentCommit)
        log(`Incremental analysis: ${changedFiles.length} changed files`)
      } else if (cached && cached.commitHash === currentCommit) {
        // Same commit — all analysis is current
        log('Analysis cache is current (same commit)')
        // Still proceed — user explicitly clicked re-analyze
      }
    }

    currentAnalysis = new AnalysisPipeline(lastGraph, lastFileSources, send, model, changedFiles)
    try {
      await currentAnalysis.run()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      log(`Analysis error: ${message}`)
      send({ type: 'analysis:error', data: { target: 'project', error: message } })
    } finally {
      currentAnalysis = null
    }
  }

  if (msg.type === 'analysis:cancel') {
    currentAnalysis?.cancel()
    currentAnalysis = null
  }
})

send({ type: 'worker:ready' })
