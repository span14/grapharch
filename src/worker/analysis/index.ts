import type {
  GraphData,
  WorkerMessage,
  ProjectAnalysis,
  LayerAssignment,
  ComponentDefinition,
  ComponentEdge,
  LayerEdge,
} from '../../shared/types'
import { callClaude, parseJsonResponse } from './client'
import {
  LAYER_SYSTEM,
  COMPONENT_SYSTEM,
  buildLayerPrompt,
  buildComponentPrompt,
} from './prompts'
import {
  writeProjectAnalysis,
  writeNodeAnalysis,
  writeManifest,
} from './cache'
import { getHeadCommit } from '../git'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function analysisLog(msg: string): void {
  try {
    const logFile = path.join(os.homedir(), '.grapharc', 'worker.log')
    fs.appendFileSync(logFile, `${new Date().toISOString()} [analysis] ${msg}\n`)
  } catch { /* ignore */ }
}

interface LayerResponse {
  summary: string
  patterns: string[]
  layers: Array<{ name: string; color: string; modules: string[] }>
  layerEdges?: LayerEdge[]
  moduleAnalysis: Record<string, { layer: string; confidence: number; reasoning: string }>
}

interface ComponentResponse {
  components: ComponentDefinition[]
  componentEdges: ComponentEdge[]
}

export class AnalysisPipeline {
  private cancelled = false
  private currentCall: { abort: () => void } | null = null

  private analyzedNodeIds: string[] = []

  constructor(
    private graph: GraphData,
    private send: (msg: WorkerMessage) => void,
    private model?: string,
  ) {}

  private flushManifest(): void {
    const rootDir = this.graph.metadata.rootDir
    writeManifest(rootDir, this.analyzedNodeIds, [])
  }

  async run(): Promise<void> {
    const rootDir = this.graph.metadata.rootDir

    // Phase A: Layer analysis — Claude explores the codebase via tools
    const project = await this.analyzeLayers()
    if (this.cancelled) return
    this.send({ type: 'analysis:project', data: project })
    writeProjectAnalysis(rootDir, project, getHeadCommit(rootDir))
    this.flushManifest()

    // Phase B: Component deep dive per layer — Claude reads files for each layer
    await this.analyzeComponents(project)
    if (this.cancelled) return
    this.send({ type: 'analysis:project', data: project })
    writeProjectAnalysis(rootDir, project, getHeadCommit(rootDir))
    this.flushManifest()

    this.send({ type: 'analysis:complete' })
  }

  cancel(): void {
    this.cancelled = true
    this.currentCall?.abort()
    this.currentCall = null
  }

  // ── Phase A: Layers (exploration-based) ─────────────────────

  private async analyzeLayers(): Promise<ProjectAnalysis> {
    const rootDir = this.graph.metadata.rootDir
    const modules = this.graph.nodes.filter((n) => n.kind === 'module')
    const moduleIds = new Set(modules.map((m) => m.id))
    const moduleEdges = this.graph.edges.filter(
      (e) => moduleIds.has(e.source) || moduleIds.has(e.target)
    )

    this.send({
      type: 'analysis:progress',
      data: { phase: 'layers', total: 1, done: 0 },
    })

    const prompt = buildLayerPrompt(rootDir, modules, moduleEdges)
    analysisLog(`Layer analysis: ${modules.length} modules, prompt ${prompt.length} chars`)
    const call = callClaude(LAYER_SYSTEM, prompt, this.model)
    this.currentCall = call
    const raw = await call.promise
    this.currentCall = null
    analysisLog(`Layer response: ${raw.length} chars`)

    let result: LayerResponse
    try {
      result = parseJsonResponse<LayerResponse>(raw)
    } catch (err) {
      analysisLog(`Layer JSON parse FAILED: ${err instanceof Error ? err.message : String(err)}`)
      analysisLog(`Layer response preview: ${raw.slice(0, 500)}`)
      throw err
    }

    // Send individual layer assignments
    for (const [moduleId, assignment] of Object.entries(result.moduleAnalysis)) {
      if (this.cancelled) return this.emptyProject()
      this.send({
        type: 'analysis:node',
        data: {
          nodeId: moduleId,
          analysis: {
            layer: assignment.layer,
            confidence: assignment.confidence,
            reasoning: assignment.reasoning,
          } satisfies LayerAssignment,
        },
      })
    }

    this.send({
      type: 'analysis:progress',
      data: { phase: 'layers', total: 1, done: 1 },
    })

    const project: ProjectAnalysis = {
      layers: result.layers,
      layerEdges: result.layerEdges ?? [],
      summary: result.summary,
      patterns: result.patterns,
      analyzedAt: new Date().toISOString(),
    }

    // Cache layer assignments
    for (const [moduleId, assignment] of Object.entries(result.moduleAnalysis)) {
      writeNodeAnalysis(rootDir, moduleId, {
        layer: assignment.layer,
        confidence: assignment.confidence,
        reasoning: assignment.reasoning,
      })
      this.analyzedNodeIds.push(moduleId)
    }

    return project
  }

  // ── Phase B: Components per layer (exploration-based) ───────

  private async analyzeComponents(project: ProjectAnalysis): Promise<void> {
    const rootDir = this.graph.metadata.rootDir
    const total = project.layers.length
    let done = 0

    this.send({ type: 'analysis:progress', data: { phase: 'components', total, done } })

    for (const layer of project.layers) {
      if (this.cancelled) return

      const layerModuleIds = new Set(layer.modules)
      const layerFunctions = this.graph.nodes.filter(
        (n) => n.kind !== 'module' && n.kind !== 'method' && layerModuleIds.has(n.filePath)
      )

      if (layerFunctions.length === 0) {
        done++
        this.send({ type: 'analysis:progress', data: { phase: 'components', total, done } })
        continue
      }

      const prompt = buildComponentPrompt(
        rootDir, layer.name, layer.modules, layerFunctions, this.graph.edges,
      )

      try {
        analysisLog(`Component analysis: layer=${layer.name}, ${layerFunctions.length} functions`)
        const call = callClaude(COMPONENT_SYSTEM, prompt, this.model)
        this.currentCall = call
        const raw = await call.promise
        this.currentCall = null
        analysisLog(`Component response: ${raw.length} chars`)
        const result = parseJsonResponse<ComponentResponse>(raw)

        layer.components = result.components
        layer.componentEdges = result.componentEdges
        analysisLog(`Component result: ${result.components.length} components, ${result.componentEdges.length} edges`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        analysisLog(`Component error: layer=${layer.name}: ${message}`)
        this.send({ type: 'analysis:error', data: { target: `layer:${layer.name}`, error: message } })
      }

      done++
      this.send({ type: 'analysis:progress', data: { phase: 'components', total, done } })
    }
  }

  private emptyProject(): ProjectAnalysis {
    return { layers: [], summary: '', patterns: [], analyzedAt: new Date().toISOString() }
  }
}
