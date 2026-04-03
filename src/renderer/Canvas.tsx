import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  useNodesInitialized,
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
import { ComponentNode } from './nodes/ComponentNode'
import { ImportEdge } from './edges/ImportEdge'
import { CallEdge } from './edges/CallEdge'

// Defined outside the component to maintain stable references for React Flow
const nodeTypes = {
  layer: LayerNode,
  component: ComponentNode,
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
  edgeAnalyses: Map<string, EdgeAnalysis>,
  onLayerSelect: (layer: string) => void,
  onLayerDrillDown: (layer: string) => void,
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
      onSelect: () => onLayerSelect(layer.name),
      onDrillDown: () => onLayerDrillDown(layer.name),
    },
  }))

  // Build module-to-layer lookup
  const moduleToLayer = new Map<string, string>()
  for (const layer of project.layers) {
    for (const mod of layer.modules) {
      moduleToLayer.set(mod, layer.name)
    }
  }

  // Use AI-interpreted layer edges if available
  if (project.layerEdges && project.layerEdges.length > 0) {
    const edges: Edge[] = project.layerEdges.map((le, i) => ({
      id: `layer-edge-${i}`,
      source: `layer:${le.source}`,
      target: `layer:${le.target}`,
      type: 'call',
      data: {
        weight: 1,
        passedType: le.description,
        passedTypes: le.dataFormats,
      },
    }))
    return { nodes, edges }
  }

  // Fallback: aggregate from raw graph edges
  const layerEdgeData = new Map<string, { count: number; edgeIds: string[] }>()
  for (const e of graph.edges) {
    const srcLayer = moduleToLayer.get(e.source)
    const tgtLayer = moduleToLayer.get(e.target)
    if (srcLayer && tgtLayer && srcLayer !== tgtLayer) {
      const key = `${srcLayer}|${tgtLayer}`
      const entry = layerEdgeData.get(key) ?? { count: 0, edgeIds: [] }
      entry.count++
      entry.edgeIds.push(e.id)
      layerEdgeData.set(key, entry)
    }
  }

  const couplingRank: Record<string, number> = { loose: 0, moderate: 1, tight: 2 }
  const couplingFromRank = ['loose', 'moderate', 'tight']

  const edges: Edge[] = []
  let idx = 0
  for (const [key, data] of layerEdgeData) {
    const [src, tgt] = key.split('|')
    const passedTypes = new Set<string>()
    let worstCoupling = 0
    for (const edgeId of data.edgeIds) {
      const ea = edgeAnalyses.get(edgeId)
      if (ea?.passedType) passedTypes.add(ea.passedType)
      if (ea?.coupling && couplingRank[ea.coupling] > worstCoupling) {
        worstCoupling = couplingRank[ea.coupling]
      }
    }
    edges.push({
      id: `layer-edge-${idx++}`,
      source: `layer:${src}`,
      target: `layer:${tgt}`,
      type: 'call',
      data: {
        weight: data.count,
        passedTypes: [...passedTypes],
        coupling: passedTypes.size > 0 ? couplingFromRank[worstCoupling] : undefined,
      },
    })
  }

  return { nodes, edges }
}

function layerComponentsToFlow(
  layerName: string,
  project: ProjectAnalysis,
  selectedNodeId: string | null,
): { nodes: Node[]; edges: Edge[] } {
  const layerDef = project.layers.find((l) => l.name === layerName)
  if (!layerDef || !layerDef.components || layerDef.components.length === 0) {
    return { nodes: [], edges: [] }
  }

  // Create a node for each AI-identified component
  const nodes: Node[] = layerDef.components.map((comp) => ({
    id: `comp:${layerName}:${comp.name}`,
    type: 'component' as const,
    position: { x: 0, y: 0 },
    data: {
      label: comp.name,
      description: comp.description,
      pseudocode: comp.pseudocode,
      functionCount: comp.functions.length,
      selected: `comp:${layerName}:${comp.name}` === selectedNodeId,
    },
  }))

  // Create edges between components
  const edges: Edge[] = (layerDef.componentEdges ?? []).map((ce, i) => ({
    id: `comp-edge-${layerName}-${i}`,
    source: `comp:${layerName}:${ce.source}`,
    target: `comp:${layerName}:${ce.target}`,
    type: 'call' as const,
    data: {
      weight: 1,
      passedType: ce.dataFormat,
      coupling: undefined,
      kind: 'call',
    },
  }))

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
  const analysisStatus = useAnalysisStore((s) => s.status)
  const viewLevel = useAnalysisStore((s) => s.viewLevel)
  const selectedLayer = useAnalysisStore((s) => s.selectedLayer)
  const setViewLevel = useAnalysisStore((s) => s.setViewLevel)
  const selectLayerFn = useAnalysisStore((s) => s.selectLayer)

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[])
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const [layoutVersion, setLayoutVersion] = useState(0)

  useEffect(() => {
    if (!graph) return

    let flowNodes: Node[]
    let flowEdges: Edge[]

    if (viewLevel === 'layers' && projectAnalysis) {
      const result = layersToFlow(
        projectAnalysis,
        graph,
        edgeAnalyses,
        (layerName) => selectNode(`layer:${layerName}`),
        (layerName) => { selectLayerFn(layerName); setViewLevel('components') },
      )
      flowNodes = result.nodes
      flowEdges = result.edges
    } else if (viewLevel === 'components' && selectedLayer && projectAnalysis) {
      const result = layerComponentsToFlow(
        selectedLayer, projectAnalysis, null,
      )
      flowNodes = result.nodes
      flowEdges = result.edges
    } else {
      // Fallback: module view (no analysis)
      const result = graphToFlow(
        graph, expandedModules, toggleModule,
        nodeAnalyses, edgeAnalyses, projectAnalysis, null,
      )
      flowNodes = result.nodes
      flowEdges = result.edges
    }

    // Run ELK layout
    computeLayout(flowNodes, flowEdges).then((layouted) => {
      setNodes(layouted)
      setEdges(flowEdges)
      setLayoutVersion((v) => v + 1)
    })
    // NOTE: selectedNodeId intentionally excluded — selection should not trigger re-layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, expandedModules, toggleModule, nodeAnalyses, edgeAnalyses, projectAnalysis, viewLevel, selectedLayer, setViewLevel, selectLayerFn, setNodes, setEdges])

  // Auto-fit viewport once nodes are measured after layout
  const lastFitVersion = useRef(0)
  useEffect(() => {
    if (nodesInitialized && layoutVersion > 0 && layoutVersion !== lastFitVersion.current) {
      lastFitVersion.current = layoutVersion
      fitView({ padding: 0.12 })
    }
  }, [nodesInitialized, layoutVersion, fitView])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Toggle: clicking the same node again deselects it
      selectNode(selectedNodeId === node.id ? null : node.id)
    },
    [selectNode, selectedNodeId]
  )

  if (!graph) return null
  if (analysisStatus === 'loading') return null

  const breadcrumbs: Array<{ label: string; onClick: () => void }> = [
    { label: 'Layers', onClick: () => { setViewLevel('layers'); selectLayerFn(null) } },
  ]
  if (selectedLayer) {
    breadcrumbs.push({ label: selectedLayer, onClick: () => { setViewLevel('components') } })
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
