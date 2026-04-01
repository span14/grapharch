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

export async function computeLayout(
  nodes: Node[],
  edges: Edge[]
): Promise<Node[]> {
  if (nodes.length === 0) return nodes

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
    const w = (node.measured?.width as number) ?? 200
    const h = (node.measured?.height as number) ?? 60
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
    layoutOptions: LAYOUT_OPTIONS,
    children: topLevel.map(toElk),
    edges: edges
      .filter((e) => {
        // Only layout edges between nodes that exist in the node list
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
