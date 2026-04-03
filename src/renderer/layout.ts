import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js'
import type { Node, Edge } from '@xyflow/react'

const elk = new ELK()

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '40',
  'elk.layered.spacing.nodeNodeBetweenLayers': '60',
  'elk.padding': '[top=40,left=20,bottom=20,right=20]',
}

const LAYER_VIEW_OPTIONS = {
  'elk.algorithm': 'stress',
  'elk.stress.desiredEdgeLength': '250',
  'elk.spacing.nodeNode': '80',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
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
  // Header (~30px) + each module item (~18px) + footer (~20px) + padding
  const w = 300
  const h = Math.max(80, 50 + count * 18 + 20)
  return { w, h }
}

export async function computeLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<Node[]> {
  if (nodes.length === 0) return nodes

  const hasLayers = nodes.some((n) => n.type === 'layer')

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
    if (node.type === 'layer') {
      const size = estimateLayerNodeSize(node)
      w = size.w
      h = size.h
    } else if (node.type === 'component') {
      const data = node.data as Record<string, unknown>
      const pseudocode = (data.pseudocode as string) ?? ''
      const lines = pseudocode.split('\n').length
      w = 320
      h = Math.max(120, 60 + lines * 16 + 40)
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
  const hasComponents = nodes.some((n) => n.type === 'component')
  const rootOptions = hasLayers ? LAYER_VIEW_OPTIONS : hasComponents ? COMPONENT_LAYOUT_OPTIONS : LAYOUT_OPTIONS

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: rootOptions,
    children: topLevel.map(toElk),
    edges: edges
      .filter((e) => {
        return nodeIdSet.has(e.source) && nodeIdSet.has(e.target)
      })
      .map(
        (e): ElkExtendedEdge => ({
          id: e.id,
          sources: [e.source],
          targets: [e.target],
        })
      ),
  }

  const result = await elk.layout(graph)

  const posMap = new Map<string, { x: number; y: number; w?: number; h?: number }>()
  function extract(elkNode: ElkNode) {
    if (elkNode.children) {
      for (const child of elkNode.children) {
        posMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0, w: child.width, h: child.height })
        extract(child)
      }
    }
  }
  extract(result)

  return nodes.map((n) => {
    const pos = posMap.get(n.id)
    if (!pos) return n
    const updated = { ...n, position: { x: pos.x, y: pos.y } }
    // Apply computed dimensions to layer nodes so React Flow renders them at the right size
    if (n.type === 'layer' && pos.w && pos.h) {
      updated.style = { ...updated.style, width: pos.w, height: pos.h }
    }
    return updated
  })
}
