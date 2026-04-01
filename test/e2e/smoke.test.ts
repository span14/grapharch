import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { initParser } from '../../src/worker/symbols'
import { buildGraph } from '../../src/worker/graph'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'sample-project')

beforeAll(async () => {
  await initParser()
})

describe('end-to-end graph building', () => {
  it('builds a complete graph from the fixture project', async () => {
    const graph = await buildGraph(FIXTURES)

    // Modules
    const modules = graph.nodes.filter((n) => n.kind === 'module')
    expect(modules.map((m) => m.label).sort()).toEqual([
      'main.py',
      'models.py',
      'sub/__init__.py',
      'sub/helpers.py',
      'utils.py',
    ])

    // Functions
    const funcs = graph.nodes.filter((n) => n.kind === 'function')
    expect(funcs.map((f) => f.label).sort()).toContain('main')
    expect(funcs.map((f) => f.label).sort()).toContain('helper')

    // Classes
    const classes = graph.nodes.filter((n) => n.kind === 'class')
    expect(classes.map((c) => c.label)).toContain('MyModel')

    // Methods
    const methods = graph.nodes.filter((n) => n.kind === 'method')
    expect(methods.length).toBeGreaterThan(0)

    // Edges exist
    expect(graph.edges.length).toBeGreaterThan(0)

    // Import edges from main.py -> utils.py
    const mainToUtils = graph.edges.find(
      (e) =>
        e.source === 'main.py' &&
        (e.target === 'utils.py' || e.target.startsWith('utils.py::'))
    )
    expect(mainToUtils).toBeDefined()

    // Rollup edges (module-level with weight)
    const rollups = graph.edges.filter((e) => e.weight !== undefined && e.weight > 0)
    expect(rollups.length).toBeGreaterThan(0)

    // Metadata
    expect(graph.metadata.fileCount).toBe(5)
    expect(graph.metadata.parsedAt).toBeDefined()
  })

  it('all node IDs are unique', async () => {
    const graph = await buildGraph(FIXTURES)
    const ids = graph.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all edge IDs are unique', async () => {
    const graph = await buildGraph(FIXTURES)
    const ids = graph.edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all edge sources and targets reference existing nodes', async () => {
    const graph = await buildGraph(FIXTURES)
    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source), `edge ${edge.id}: source ${edge.source} not in nodes`).toBe(true)
      expect(nodeIds.has(edge.target), `edge ${edge.id}: target ${edge.target} not in nodes`).toBe(true)
    }
  })
})
