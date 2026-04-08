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
import { readProjectAnalysis, readAllCachedAnalysis, applyComponentUpdate, withCacheLock } from './analysis/cache'
import { COMPONENT_CHAT_SYSTEM, buildComponentChatPrompt } from './analysis/prompts'
import { callClaudeChat, parseJsonResponse, getSession, setSession, deleteSession, clearSessions } from './analysis/client'
import type { GraphData, WorkerMessage, ComponentChatRequest } from '../shared/types'
import type { ClaudeCall } from './analysis/client'
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

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  try { send({ type: 'parse:error', data: { file: 'worker', error: `Unhandled error: ${msg}` } }) } catch { /* ignore */ }
  console.error('Unhandled rejection in worker:', reason)
})

let currentRootDir: string | null = null
let parserInitialized = false
let lastFileSources: Map<string, string> | null = null
let lastGraph: GraphData | null = null
let currentAnalysis: AnalysisPipeline | null = null
let currentChatCall: ClaudeCall | null = null
let currentChatSessionKey: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function send(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

function graphsEqual(a: GraphData, b: GraphData): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  const aNodes = JSON.stringify(a.nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind, lineRange: n.lineRange })))
  const bNodes = JSON.stringify(b.nodes.map(n => ({ id: n.id, label: n.label, kind: n.kind, lineRange: n.lineRange })))
  if (aNodes !== bNodes) return false
  const aEdges = JSON.stringify(a.edges.map(e => ({ id: e.id, source: e.source, target: e.target, kind: e.kind })))
  const bEdges = JSON.stringify(b.edges.map(e => ({ id: e.id, source: e.source, target: e.target, kind: e.kind })))
  return aEdges === bEdges
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
  // Do NOT send analysis:complete here; let the pipeline's run() handle
  // completion when it detects the cancelled flag.
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

  switch (msg.type) {
    case 'project:open': {
      const { rootDir } = msg.data as { rootDir: string }
      currentRootDir = rootDir
      stopWatching()
      clearSessions()
      if (currentChatCall) {
        currentChatCall.abort()
        currentChatCall = null
        currentChatSessionKey = null
      }

      try {
        log(`project:open rootDir=${rootDir}`)
        const cachedResult = await readCache(rootDir)

        // Check if analysis cache exists — signal loading BEFORE sending graph
        // so the renderer shows loading overlay instead of raw module graph
        const cachedAnalysis = readAllCachedAnalysis(rootDir)
        const totalCached = (cachedAnalysis.project ? 1 : 0) + cachedAnalysis.nodes.size + cachedAnalysis.edges.size
        if (totalCached > 0) {
          send({ type: 'analysis:cache-loading', data: { total: totalCached, done: 0 } })
        }

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
        if (totalCached > 0) {
          let loaded = 0

          if (cachedAnalysis.project) {
            send({ type: 'analysis:project', data: cachedAnalysis.project })
            loaded++
            send({ type: 'analysis:cache-loading', data: { total: totalCached, done: loaded } })
          }
          for (const [nodeId, analysis] of cachedAnalysis.nodes) {
            send({ type: 'analysis:node', data: { nodeId, analysis } })
            loaded++
          }
          send({ type: 'analysis:cache-loading', data: { total: totalCached, done: loaded } })
          for (const [edgeId, analysis] of cachedAnalysis.edges) {
            send({ type: 'analysis:edge', data: { edgeId, analysis } })
            loaded++
          }
          send({ type: 'analysis:cache-loading', data: { total: totalCached, done: loaded } })
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message + '\n' + (err as Error).stack : String(err)
        log(`ERROR: ${message}`)
        send({ type: 'parse:error', data: { file: rootDir, error: message } })
      }
      break
    }

    case 'project:refresh': {
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
      break
    }

    case 'analysis:start': {
      if (!lastGraph) {
        send({ type: 'analysis:error', data: { target: 'project', error: 'No project loaded. Open a project first.' } })
        return
      }

      // Cancel any running analysis
      currentAnalysis?.cancel()

      const model = (msg.data as { model?: string })?.model

      const pipeline = new AnalysisPipeline(lastGraph, send, model)
      currentAnalysis = pipeline
      try {
        await pipeline.run()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log(`Analysis error: ${message}`)
        if (!pipeline.isCancelled) {
          send({ type: 'analysis:error', data: { target: 'project', error: message } })
        }
      } finally {
        // Only clean up if this pipeline is still the active one
        // (a new analysis:start may have replaced it)
        if (currentAnalysis === pipeline) {
          currentAnalysis = null
        }
        // Only send complete if the pipeline wasn't cancelled
        // (cancel handler does not send complete — the UI stays in 'idle')
        if (!pipeline.isCancelled) {
          send({ type: 'analysis:complete' })
        }
      }
      return
    }

    case 'analysis:cancel': {
      currentAnalysis?.cancel()
      currentAnalysis = null
      send({ type: 'analysis:complete' })
      break
    }

    case 'component:chat': {
      const request = msg.data as unknown as ComponentChatRequest
      const requestId = request.requestId
      const sessionKey = `comp:${currentRootDir}:${request.layerName}:${request.componentName}`
      try {
        // Abort any in-flight chat for the same component
        if (currentChatCall && currentChatSessionKey === sessionKey) {
          currentChatCall.abort()
          currentChatCall = null
          currentChatSessionKey = null
        }

        const hasSession = !!getSession(sessionKey)
        // Override rootDir with the trusted currentRootDir
        const chatRequest = { ...(request as any), rootDir: currentRootDir ?? request.rootDir }
        // On resume, just send the user's message — Claude already has context
        const prompt = hasSession
          ? `${request.message}\n\nRespond with JSON: {"text": "...", "componentUpdate": null, "edgeUpdates": null}`
          : buildComponentChatPrompt(chatRequest)
        log(`Component chat: ${request.layerName}/${request.componentName} (session: ${sessionKey}, resume: ${hasSession})`)
        const call = callClaudeChat(sessionKey, COMPONENT_CHAT_SYSTEM, prompt, request.model)
        currentChatCall = call
        currentChatSessionKey = sessionKey
        const raw = await call.promise
        currentChatCall = null
        currentChatSessionKey = null
        const result = parseJsonResponse<{ text: string; componentUpdate?: unknown; edgeUpdates?: unknown[] }>(raw)

        // Persist update if Claude suggested changes
        if (result.componentUpdate && currentRootDir) {
          await withCacheLock(currentRootDir, () => {
            applyComponentUpdate(
              currentRootDir!,
              request.layerName,
              request.componentName,
              result.componentUpdate as any,
              result.edgeUpdates as any,
            )
          })
        }

        // Handle component rename in session map
        const updatedComp = result.componentUpdate as { name?: string } | undefined
        if (updatedComp && updatedComp.name && updatedComp.name !== request.componentName) {
          const newSessionKey = `comp:${currentRootDir}:${request.layerName}:${updatedComp.name}`
          const existingSessionId = getSession(sessionKey)
          if (existingSessionId) {
            setSession(newSessionKey, existingSessionId)
          }
          deleteSession(sessionKey)
        }

        send({
          type: 'component:chat-response',
          data: {
            requestId,
            layerName: request.layerName,
            componentName: request.componentName,
            text: result.text,
            componentUpdate: result.componentUpdate as any,
            edgeUpdates: result.edgeUpdates as any,
          },
        })
      } catch (err: unknown) {
        currentChatCall = null
        currentChatSessionKey = null
        const message = err instanceof Error ? err.message : String(err)
        log(`Component chat error: ${message}`)
        send({ type: 'component:chat-error', data: { requestId, error: message } })
      }
      break
    }

    case 'component:edit': {
      const request = msg.data as { layerName: string; componentName: string; updates: Record<string, unknown>; rootDir: string }
      try {
        // Validate that updates only contains known ComponentDefinition keys
        const allowedKeys = new Set(['name', 'description', 'pseudocode', 'functions', 'output'])
        const unknownKeys = Object.keys(request.updates).filter((k) => !allowedKeys.has(k))
        if (unknownKeys.length > 0) {
          throw new Error(`Unknown update keys: ${unknownKeys.join(', ')}`)
        }

        const rootDir = currentRootDir ?? request.rootDir
        const cached = readProjectAnalysis(rootDir)
        if (cached) {
          const layer = cached.analysis.layers.find((l) => l.name === request.layerName)
          const comp = layer?.components?.find((c) => c.name === request.componentName)
          if (comp) {
            const updated = { ...comp, ...request.updates }
            await withCacheLock(rootDir, () => {
              applyComponentUpdate(rootDir, request.layerName, request.componentName, updated as any)
            })
            const refreshed = readProjectAnalysis(rootDir)
            if (refreshed) {
              send({ type: 'analysis:project', data: refreshed.analysis })
            }
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log(`Component edit error: ${message}`)
        send({ type: 'component:chat-error', data: { requestId: `edit-${Date.now()}`, error: message } })
      }
      break
    }
  }
})

send({ type: 'worker:ready' })
