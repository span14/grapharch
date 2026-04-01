import type {
  GraphData,
  GraphNode,
  GraphEdge,
  WorkerMessage,
  ProjectAnalysis,
  FunctionAnalysis,
  LayerAssignment,
  EdgeAnalysis,
} from '../../shared/types'
import { callClaude, parseJsonResponse } from './client'
import {
  LAYER_SYSTEM,
  FUNCTION_SYSTEM,
  EDGE_SYSTEM,
  buildLayerPrompt,
  buildFunctionPrompt,
  buildEdgePrompt,
} from './prompts'
import { batchNodes, batchEdges } from './batcher'
import { getCodePreview } from './sourceCollector'
import {
  writeProjectAnalysis,
  writeNodeAnalysis,
  writeEdgeAnalysis,
  writeManifest,
} from './cache'
import { getHeadCommit } from '../git'

interface LayerResponse {
  summary: string
  patterns: string[]
  layers: Array<{ name: string; color: string; modules: string[] }>
  moduleAnalysis: Record<string, { layer: string; confidence: number; reasoning: string }>
}

interface FunctionResponse {
  functions: Record<string, Omit<FunctionAnalysis, 'codePreview'>>
}

interface EdgeResponse {
  edges: Record<string, EdgeAnalysis>
}

export class AnalysisPipeline {
  private cancelled = false
  private currentCall: { abort: () => void } | null = null

  private analyzedNodeIds: string[] = []
  private analyzedEdgeIds: string[] = []

  constructor(
    private graph: GraphData,
    private fileSources: Map<string, string>,
    private send: (msg: WorkerMessage) => void,
    private model?: string,
    private changedFiles?: string[] | null,
  ) {}

  async run(): Promise<void> {
    // Phase A: Layer analysis
    const project = await this.analyzeLayers()
    if (this.cancelled) return
    this.send({ type: 'analysis:project', data: project })

    // Phase B: Function/class/method analysis
    await this.analyzeFunctions(project)
    if (this.cancelled) return

    // Phase C: Edge analysis
    await this.analyzeEdges(project)

    // Write manifest and commit hash for cache invalidation
    if (!this.cancelled) {
      const rootDir = this.graph.metadata.rootDir
      writeManifest(rootDir, this.analyzedNodeIds, this.analyzedEdgeIds)
      const commitHash = getHeadCommit(rootDir)
      writeProjectAnalysis(rootDir, project, commitHash)
      this.send({ type: 'analysis:complete' })
    }
  }

  cancel(): void {
    this.cancelled = true
    this.currentCall?.abort()
    this.currentCall = null
  }

  // ── Phase A: Layers ──────────────────────────────────────────

  private async analyzeLayers(): Promise<ProjectAnalysis> {
    const modules = this.graph.nodes.filter((n) => n.kind === 'module')
    // Use rollup edges (module-level) for the import graph
    const moduleIds = new Set(modules.map((m) => m.id))
    const moduleEdges = this.graph.edges.filter(
      (e) => moduleIds.has(e.source) && moduleIds.has(e.target)
    )

    this.send({
      type: 'analysis:progress',
      data: { phase: 'layers', total: modules.length, done: 0 },
    })

    const prompt = buildLayerPrompt(modules, moduleEdges, this.fileSources)
    const call = callClaude(LAYER_SYSTEM, prompt, this.model)
    this.currentCall = call
    const raw = await call.promise
    this.currentCall = null
    const result = parseJsonResponse<LayerResponse>(raw)

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
      data: { phase: 'layers', total: modules.length, done: modules.length },
    })

    const project: ProjectAnalysis = {
      layers: result.layers,
      summary: result.summary,
      patterns: result.patterns,
      analyzedAt: new Date().toISOString(),
    }

    // Cache individual layer assignments
    const rootDir = this.graph.metadata.rootDir
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

  // ── Phase B: Functions ───────────────────────────────────────

  private async analyzeFunctions(project: ProjectAnalysis): Promise<void> {
    let functions = this.graph.nodes.filter((n) => n.kind !== 'module')

    // If changedFiles provided, only analyze functions in changed files
    if (this.changedFiles && this.changedFiles.length > 0) {
      const changedSet = new Set(this.changedFiles)
      functions = functions.filter((n) => changedSet.has(n.filePath))
    }

    const batches = batchNodes(functions, this.fileSources)
    const total = functions.length
    let done = 0

    this.send({ type: 'analysis:progress', data: { phase: 'functions', total, done } })

    // Build layer lookup for context
    const layerMap = new Map<string, string>()
    for (const layer of project.layers) {
      for (const mod of layer.modules) {
        layerMap.set(mod, layer.name)
      }
    }

    for (const batch of batches) {
      if (this.cancelled) return

      const layerName = layerMap.get(batch[0]?.filePath ?? '') ?? undefined
      const prompt = buildFunctionPrompt(batch, this.graph.edges, this.fileSources, layerName)

      try {
        const call = callClaude(FUNCTION_SYSTEM, prompt, this.model)
        this.currentCall = call
        const raw = await call.promise
        this.currentCall = null
        const result = parseJsonResponse<FunctionResponse>(raw)

        for (const node of batch) {
          const analysis = result.functions[node.label]
          if (analysis) {
            const codePreview = getCodePreview(node, this.fileSources)
            const fullAnalysis: FunctionAnalysis = { ...analysis, codePreview }
            this.send({
              type: 'analysis:node',
              data: { nodeId: node.id, analysis: fullAnalysis },
            })
            writeNodeAnalysis(this.graph.metadata.rootDir, node.id, fullAnalysis)
            this.analyzedNodeIds.push(node.id)
          }
          done++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        for (const node of batch) {
          this.send({ type: 'analysis:error', data: { target: node.id, error: message } })
          done++
        }
      }

      this.send({ type: 'analysis:progress', data: { phase: 'functions', total, done } })
    }
  }

  // ── Phase C: Edges ───────────────────────────────────────────

  private async analyzeEdges(project: ProjectAnalysis): Promise<void> {
    // Only analyze cross-module call edges between functions (not rollup edges)
    const nodeMap = new Map(this.graph.nodes.map((n) => [n.id, n]))
    let crossModuleCallEdges = this.graph.edges.filter((e) => {
      if (e.kind !== 'call') return false
      const src = nodeMap.get(e.source)
      const tgt = nodeMap.get(e.target)
      return src && tgt && src.filePath !== tgt.filePath
    })

    // If changedFiles provided, only analyze edges touching changed files
    if (this.changedFiles && this.changedFiles.length > 0) {
      const changedSet = new Set(this.changedFiles)
      crossModuleCallEdges = crossModuleCallEdges.filter((e) => {
        const src = nodeMap.get(e.source)
        const tgt = nodeMap.get(e.target)
        return (src && changedSet.has(src.filePath)) || (tgt && changedSet.has(tgt.filePath))
      })
    }

    const batches = batchEdges(crossModuleCallEdges, nodeMap, this.fileSources)
    const total = crossModuleCallEdges.length
    let done = 0

    this.send({ type: 'analysis:progress', data: { phase: 'edges', total, done } })

    // Build layer lookup
    const layerMap = new Map<string, string>()
    for (const layer of project.layers) {
      for (const mod of layer.modules) {
        layerMap.set(mod, layer.name)
      }
    }

    for (const batch of batches) {
      if (this.cancelled) return

      const prompt = buildEdgePrompt(batch, this.fileSources, layerMap)

      try {
        const call = callClaude(EDGE_SYSTEM, prompt, this.model)
        this.currentCall = call
        const raw = await call.promise
        this.currentCall = null
        const result = parseJsonResponse<EdgeResponse>(raw)

        for (const { edge } of batch) {
          const analysis = result.edges[edge.id]
          if (analysis) {
            this.send({
              type: 'analysis:edge',
              data: { edgeId: edge.id, analysis },
            })
            writeEdgeAnalysis(this.graph.metadata.rootDir, edge.id, analysis)
            this.analyzedEdgeIds.push(edge.id)
          }
          done++
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        for (const { edge } of batch) {
          this.send({ type: 'analysis:error', data: { target: edge.id, error: message } })
          done++
        }
      }

      this.send({ type: 'analysis:progress', data: { phase: 'edges', total, done } })
    }
  }

  private emptyProject(): ProjectAnalysis {
    return { layers: [], summary: '', patterns: [], analyzedAt: new Date().toISOString() }
  }
}
