import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'

const elk = new ELK()

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.padding': '[top=40,left=20,bottom=20,right=20]',
}

const COMPONENT_LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '50',
  'elk.layered.spacing.nodeNodeBetweenLayers': '70',
  'elk.padding': '[top=40,left=20,bottom=20,right=20]',
}

function estimateLayerNodeSize(node: Node): { w: number; h: number } {
  const modules = (node.data as Record<string, unknown>).modules as string[] | undefined
  const count = modules?.length ?? 0
  const w = 300
  const h = Math.max(80, 50 + count * 18 + 20)
  return { w, h }
}

function estimateComponentNodeSize(node: Node): { w: number; h: number } {
  const data = node.data as Record<string, unknown>
  const pseudocode = (data.pseudocode as string) ?? ''
  const lines = pseudocode.split('\n').length
  const hasOutput = !!data.output
  return { w: 320, h: Math.max(120, 60 + lines * 16 + (hasOutput ? 60 : 0) + 40) }
}

// ── Dagre layout for layer view (Sugiyama — guarantees no overlap) ──

function computeDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({
    rankdir: 'TB',
    nodesep: 60,
    ranksep: 80,
    edgesep: 20,
    marginx: 40,
    marginy: 40,
  })

  for (const node of nodes) {
    let w: number, h: number
    if (node.type === 'layer') {
      const size = estimateLayerNodeSize(node)
      w = size.w; h = size.h
    } else if (node.type === 'component') {
      const size = estimateComponentNodeSize(node)
      w = size.w; h = size.h
    } else {
      w = (node.measured?.width as number) ?? 200
      h = (node.measured?.height as number) ?? 60
    }
    g.setNode(node.id, { width: w, height: h })
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    const w = pos.width
    const h = pos.height
    const updated = {
      ...node,
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    }
    if (node.type === 'layer') {
      updated.style = { ...updated.style, width: w, height: h }
    }
    return updated
  })
}

// ── ELK layout for module/component views ──────────────────────

async function computeElkLayout(
  nodes: Node[],
  edges: Edge[],
  rootOptions: Record<string, string>,
): Promise<Node[]> {
  const topLevel = nodes.filter((n) => !n.parentId)
  const childrenByParent = new Map<string, Node[]>()
  for (const n of nodes) {
    if (n.parentId) {
      const list = childrenByParent.get(n.parentId) ?? []
      list.push(n)
      childrenByParent.set(n.parentId, list)
    }
  }

  function toElk(node: Node): ElkNode {
    const children = childrenByParent.get(node.id)
    let w: number, h: number
    if (node.type === 'component') {
      const size = estimateComponentNodeSize(node)
      w = size.w; h = size.h
    } else {
      w = (node.measured?.width as number) ?? 200
      h = (node.measured?.height as number) ?? 60
    }
    return {
      id: node.id,
      width: w,
      height: h,
      ...(children
        ? { children: children.map(toElk), layoutOptions: LAYOUT_OPTIONS }
        : {}),
    }
  }

  const nodeIdSet = new Set(nodes.map((n) => n.id))
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: rootOptions,
    children: topLevel.map(toElk),
    edges: edges
      .filter((e) => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
      .map((e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
      })),
  }

  const result = await elk.layout(graph)

  const posMap = new Map<string, { x: number; y: number }>()
  function extract(elkNode: ElkNode) {
    if (elkNode.children) {
      for (const child of elkNode.children) {
        posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 })
        extract(child)
      }
    }
  }
  extract(result)

  return nodes.map((n) => {
    const pos = posMap.get(n.id)
    return pos ? { ...n, position: pos } : n
  })
}

// ── Public API ─────────────────────────────────────────────────

export async function computeLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<Node[]> {
  if (nodes.length === 0) return nodes

  const hasLayers = nodes.some((n) => n.type === 'layer')
  const hasComponents = nodes.some((n) => n.type === 'component')

  // Layer view: use dagre (Sugiyama — guaranteed no overlap)
  if (hasLayers) {
    return computeDagreLayout(nodes, edges)
  }

  // Component view: use dagre too (clean DAG layout)
  if (hasComponents) {
    return computeDagreLayout(nodes, edges)
  }

  // Module/function view: use ELK (supports compound nodes)
  return computeElkLayout(nodes, edges, LAYOUT_OPTIONS)
}
