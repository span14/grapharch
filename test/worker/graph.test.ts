import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { initParser } from '../../src/worker/symbols'
import { buildGraph } from '../../src/worker/graph'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'sample-project')

beforeAll(async () => {
  await initParser()
})

describe('buildGraph', () => {
  it('produces a complete GraphData from a project directory', async () => {
    const { graph } = await buildGraph(FIXTURES)

    expect(graph.metadata.rootDir).toBe(FIXTURES)
    expect(graph.metadata.fileCount).toBe(5)

    // Should have module nodes for each .py file
    const modules = graph.nodes.filter((n) => n.kind === 'module')
    expect(modules.length).toBe(5)

    // Should have edges
    expect(graph.edges.length).toBeGreaterThan(0)
  })

  it('creates module-level rollup edges', async () => {
    const { graph } = await buildGraph(FIXTURES)

    // Rollup edges have a weight field
    const rollupEdges = graph.edges.filter((e) => e.weight !== undefined && e.weight > 0)
    // There should be at least one rollup (e.g., main.py -> utils.py)
    expect(rollupEdges.length).toBeGreaterThan(0)

    // Rollup edges should connect module nodes
    const moduleIds = new Set(
      graph.nodes.filter((n) => n.kind === 'module').map((n) => n.id)
    )
    for (const edge of rollupEdges) {
      expect(moduleIds.has(edge.source)).toBe(true)
      expect(moduleIds.has(edge.target)).toBe(true)
    }
  })

  it('includes parsedAt timestamp in metadata', async () => {
    const { graph } = await buildGraph(FIXTURES)
    expect(graph.metadata.parsedAt).toBeDefined()
    // Should be a valid ISO date
    expect(() => new Date(graph.metadata.parsedAt)).not.toThrow()
  })
})
