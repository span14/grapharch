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
import { computeLayout } from './layout'
import { ModuleNode } from './nodes/ModuleNode'
import { FunctionNode } from './nodes/FunctionNode'
import { ClassNode } from './nodes/ClassNode'
import { MethodNode } from './nodes/MethodNode'
import { ImportEdge } from './edges/ImportEdge'
import { CallEdge } from './edges/CallEdge'
import type { GraphData, GraphNode as GNode } from '../shared/types'

// Defined outside the component to maintain stable references for React Flow
const nodeTypes = {
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

function graphToFlow(
  graph: GraphData,
  expandedModules: Set<string>,
  onToggle: (id: string) => void
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  for (const n of graph.nodes) {
    if (n.kind === 'module') {
      const expanded = expandedModules.has(n.id)
      nodes.push({
        id: n.id,
        type: 'module',
        position: { x: 0, y: 0 },
        data: {
          label: n.label,
          childCount: n.childCount ?? 0,
          expanded,
          onToggle: () => onToggle(n.id),
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
        },
      })
    }
  }

  for (const e of graph.edges) {
    // Only show edges between visible nodes
    const srcVisible = nodes.some((n) => n.id === e.source)
    const tgtVisible = nodes.some((n) => n.id === e.target)
    if (srcVisible && tgtVisible) {
      edges.push({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.kind,
        data: { weight: e.weight },
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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([] as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([] as Edge[])
  const [layoutDone, setLayoutDone] = useState(false)

  useEffect(() => {
    if (!graph) return

    const { nodes: flowNodes, edges: flowEdges } = graphToFlow(
      graph,
      expandedModules,
      toggleModule
    )

    // Run ELK layout
    computeLayout(flowNodes, flowEdges).then((layouted) => {
      setNodes(layouted)
      setEdges(flowEdges)
      setLayoutDone(true)
    })
  }, [graph, expandedModules, toggleModule, setNodes, setEdges])

  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id)
    },
    [selectNode]
  )

  if (!graph) return null

  return (
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
    </ReactFlow>
  )
}
