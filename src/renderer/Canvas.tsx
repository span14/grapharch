import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useGraphStore } from './stores/graphStore'
import {
  useAnalysisStore,
  isLayerAssignment,
  isFunctionAnalysis,
  type NodeAnalysis,
} from './stores/analysisStore'
import type { EdgeAnalysis, ProjectAnalysis, GraphData, GraphNode as GNode } from '../shared/types'
import { computeLayout } from './layout'
import { ModuleNode } from './nodes/ModuleNode'
import { LayerNode } from './nodes/LayerNode'
import { FunctionNode } from './nodes/FunctionNode'
import { ClassNode } from './nodes/ClassNode'
import { MethodNode } from './nodes/MethodNode'
import { ImportEdge } from './edges/ImportEdge'
import { CallEdge } from './edges/CallEdge'

// Defined outside the component to maintain stable references for React Flow
const nodeTypes = {
  layer: LayerNode,
  module: ModuleNode,
  function: FunctionNode,
  class: ClassNode,
  method: MethodNode,
}

const edgeTypes = {
  import: ImportEdge,
  call: CallEdge,
  import_unresolved: ImportEdge,
}

function getModuleId(node: GNode, allNodes: GNode[]): string {
  if (node.kind === 'module') return node.id
  if (node.parent) {
    const parent = allNodes.find((n) => n.id === node.parent)
    if (parent) return getModuleId(parent, allNodes)
  }
  return node.id
}

function layersToFlow(
  project: ProjectAnalysis,
  graph: GraphData,
  onLayerClick: (layer: string) => void,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = project.layers.map((layer) => ({
    id: `layer:${layer.name}`,
    type: 'layer',
    position: { x: 0, y: 0 },
    data: {
      label: layer.name,
      color: layer.color,
      modules: layer.modules,
      moduleCount: layer.modules.length,
      onClick: () => onLayerClick(layer.name),
    },
  }))

  // Build module-to-layer lookup
  const moduleToLayer = new Map<string, string>()
  for (const layer of project.layers) {
    for (const mod of layer.modules) {
      moduleToLayer.set(mod, layer.name)
    }
  }

  // Create edges between layers from cross-layer module edges
  const layerEdgeCounts = new Map<string, number>()
  for (const e of graph.edges) {
    const srcLayer = moduleToLayer.get(e.source)
    const tgtLayer = moduleToLayer.get(e.target)
    if (srcLayer && tgtLayer && srcLayer !== tgtLayer) {
      const key = `${srcLayer}|${tgtLayer}`
      layerEdgeCounts.set(key, (layerEdgeCounts.get(key) ?? 0) + 1)
    }
  }

  const edges: Edge[] = []
  let idx = 0
  for (const [key, count] of layerEdgeCounts) {
    const [src, tgt] = key.split('|')
    edges.push({
      id: `layer-edge-${idx++}`,
      source: `layer:${src}`,
      target: `layer:${tgt}`,
      type: 'call',
      data: { weight: count },
    })
  }

  return { nodes, edges }
}

function graphToFlow(
  graph: GraphData,
  expandedModules: Set<string>,
  onToggle: (id: string) => void,
  nodeAnalyses: Map<string, NodeAnalysis>,
  edgeAnalyses: Map<string, EdgeAnalysis>,
  projectAnalysis: ProjectAnalysis | null,
  selectedNodeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Build layer color lookup from project analysis
  const layerColors = new Map<string, string>()
  if (projectAnalysis) {
    for (const layer of projectAnalysis.layers) {
      for (const mod of layer.modules) {
        layerColors.set(mod, layer.color)
      }
    }
  }

  for (const n of graph.nodes) {
    if (n.kind === 'module') {
      const expanded = expandedModules.has(n.id)
      const layerData = nodeAnalyses.get(n.id)
      const layer = layerData && isLayerAssignment(layerData) ? layerData : null
      nodes.push({
        id: n.id,
        type: 'module',
        position: { x: 0, y: 0 },
        data: {
          label: n.label,
          childCount: n.childCount ?? 0,
          expanded,
          onToggle: () => onToggle(n.id),
          layerName: layer?.layer,
          layerColor: layerColors.get(n.id),
          selected: n.id === selectedNodeId,
        },
        ...(expanded
          ? { style: { width: 350, height: 300 } }
          : {}),
      })
    } else if (
      (n.kind === 'function' || n.kind === 'class' || n.kind === 'method') &&
      n.parent &&
      expandedModules.has(getModuleId(n, graph.nodes))
    ) {
      const parentModule = getModuleId(n, graph.nodes)
      const fnData = nodeAnalyses.get(n.id)
      const analysis = fnData && isFunctionAnalysis(fnData) ? fnData : null
      nodes.push({
        id: n.id,
        type: n.kind,
        position: { x: 0, y: 0 },
        parentId: n.kind === 'method' ? n.parent : parentModule,
        extent: 'parent' as const,
        data: {
          label: n.label,
          ...(n.kind === 'function'
            ? {
                async: n.metadata.async as boolean,
                lineCount: n.lineRange[1] - n.lineRange[0] + 1,
              }
            : {}),
          ...(n.kind === 'class'
            ? { methodCount: n.childCount ?? 0 }
            : {}),
          summary: analysis?.summary,
          complexity: analysis?.complexity,
          parameters: analysis?.parameters,
          returnType: analysis?.returnType,
          selected: n.id === selectedNodeId,
        },
      })
    }
  }

  for (const e of graph.edges) {
    const srcVisible = nodes.some((n) => n.id === e.source)
    const tgtVisible = nodes.some((n) => n.id === e.target)
    if (srcVisible && tgtVisible) {
      const edgeAn = edgeAnalyses.get(e.id)
      edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.kind,
        data: {
          weight: e.weight,
          passedType: edgeAn?.passedType,
          coupling: edgeAn?.coupling,
          kind: e.kind,
        },
      })
    }
  }

  return { nodes, edges }
}

export function Canvas() {
  const graph = useGraphStore((s) => s.graph)
  const expandedModules = useGraphStore((s) => s.expandedModules)
  const toggleModule = useGraphStore((s) => s.toggleModule)
  const selectNode = useGraphStore((s) => s.selectNode)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const nodeAnalyses = useAnalysisStore((s) => s.nodeAnalyses)
  const edgeAnalyses = useAnalysisStore((s) => s.edgeAnalyses)
  const projectAnalysis = useAnalysisStore((s) => s.projectAnalysis)
  const viewLevel = useAnalysisStore((s) => s.viewLevel)
  const selectedLayer = useAnalysisStore((s) => s.selectedLayer)
  const setViewLevel = useAnalysisStore((s) => s.setViewLevel)
  const selectLayerFn = useAnalysisStore((s) => s.selectLayer)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[])
  const [layoutDone, setLayoutDone] = useState(false)

  useEffect(() => {
    if (!graph) return

    let flowNodes: Node[]
    let flowEdges: Edge[]

    if (viewLevel === 'layers' && projectAnalysis) {
      const result = layersToFlow(projectAnalysis, graph, (layerName) => {
        selectLayerFn(layerName)
        setViewLevel('modules')
      })
      flowNodes = result.nodes
      flowEdges = result.edges
    } else {
      const result = graphToFlow(
        graph,
        expandedModules,
        toggleModule,
        nodeAnalyses,
        edgeAnalyses,
        projectAnalysis,
        selectedNodeId,
      )
      // If a layer is selected, filter to only that layer's modules
      if (selectedLayer && projectAnalysis) {
        const layerDef = projectAnalysis.layers.find((l) => l.name === selectedLayer)
        if (layerDef) {
          const layerModuleIds = new Set(layerDef.modules)
          flowNodes = result.nodes.filter((n) => {
            if (n.type === 'module') return layerModuleIds.has(n.id)
            // Keep child nodes if their parent module is in the layer
            if (n.parentId) return layerModuleIds.has(n.parentId as string)
            return true
          })
          const nodeIds = new Set(flowNodes.map((n) => n.id))
          flowEdges = result.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
        } else {
          flowNodes = result.nodes
          flowEdges = result.edges
        }
      } else {
        flowNodes = result.nodes
        flowEdges = result.edges
      }
    }

    // Run ELK layout
    computeLayout(flowNodes, flowEdges).then((layouted) => {
      setNodes(layouted)
      setEdges(flowEdges)
      setLayoutDone(true)
    })
  }, [graph, expandedModules, toggleModule, nodeAnalyses, edgeAnalyses, projectAnalysis, viewLevel, selectedLayer, setViewLevel, selectLayerFn, setNodes, setEdges, selectedNodeId])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id)
    },
    [selectNode]
  )

  if (!graph) return null

  const breadcrumbs: Array<{ label: string; onClick: () => void }> = [
    { label: 'Layers', onClick: () => { setViewLevel('layers'); selectLayerFn(null) } },
  ]
  if (selectedLayer) {
    breadcrumbs.push({ label: selectedLayer, onClick: () => { setViewLevel('modules') } })
  }

  return (
    <>
      {projectAnalysis && (
        <div className="breadcrumb">
          {breadcrumbs.map((b, i) => (
            <span key={i}>
              {i > 0 && <span className="breadcrumb-sep">&gt;</span>}
              <button className="breadcrumb-btn" onClick={b.onClick}>{b.label}</button>
            </span>
          ))}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={layoutDone}
        minZoom={0.1}
        maxZoom={2}
      >
        <Background />
        <Controls />
        <MiniMap />
        <svg style={{ position: 'absolute', width: 0, height: 0 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#3b82f6" />
            </marker>
            <marker id="arrow-gray" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
            </marker>
            <marker id="arrow-red" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#ef4444" />
            </marker>
            <marker id="arrow-green" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#22c55e" />
            </marker>
            <marker id="arrow-yellow" viewBox="0 0 10 10" refX="10" refY="5"
              markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#eab308" />
            </marker>
          </defs>
        </svg>
      </ReactFlow>
    </>
  )
}
