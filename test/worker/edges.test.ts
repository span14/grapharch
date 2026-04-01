import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs/promises'
import { initParser, extractSymbols } from '../../src/worker/symbols'
import { resolveEdges } from '../../src/worker/edges'
import { discoverPythonFiles } from '../../src/worker/discovery'
import type { GraphNode } from '../../src/shared/types'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'sample-project')

let allNodes: GraphNode[]
let fileSources: Map<string, string>

beforeAll(async () => {
  await initParser()
  const files = await discoverPythonFiles(FIXTURES)
  allNodes = []
  fileSources = new Map()
  for (const file of files) {
    const rel = path.relative(FIXTURES, file)
    const source = await fs.readFile(file, 'utf-8')
    fileSources.set(rel, source)
    allNodes.push(...extractSymbols(source, rel))
  }
})

describe('resolveEdges', () => {
  it('resolves import edges between project modules', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const importEdges = edges.filter((e) => e.kind === 'import')
    // main.py imports from utils and sub.helpers
    const mainImports = importEdges.filter((e) => e.source === 'main.py')
    expect(mainImports.length).toBeGreaterThanOrEqual(1)
  })

  it('does not create edges for stdlib imports', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const osEdge = edges.find((e) => e.target === 'os' || e.target === 'os.py')
    expect(osEdge).toBeUndefined()
  })

  it('resolves utils.py importing from models', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const importEdges = edges.filter((e) => e.kind === 'import')
    const utilsToModels = importEdges.find(
      (e) => e.source === 'utils.py' && e.target.startsWith('models')
    )
    expect(utilsToModels).toBeDefined()
  })

  it('resolves from-import to specific symbols when known', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const importEdges = edges.filter((e) => e.kind === 'import')
    // main.py: "from utils import helper" should target utils.py::helper
    const helperImport = importEdges.find(
      (e) => e.source === 'main.py' && e.target === 'utils.py::helper'
    )
    expect(helperImport).toBeDefined()
  })

  it('resolves from-import for sub.helpers', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const importEdges = edges.filter((e) => e.kind === 'import')
    // main.py: "from sub.helpers import deep_helper"
    const deepHelperImport = importEdges.find(
      (e) =>
        e.source === 'main.py' &&
        e.target === path.join('sub', 'helpers.py') + '::deep_helper'
    )
    expect(deepHelperImport).toBeDefined()
  })

  it('resolves call edges for cross-file function calls', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const callEdges = edges.filter((e) => e.kind === 'call')
    // main.py::main calls helper (from utils.py) and deep_helper (from sub/helpers.py)
    const mainCalls = callEdges.filter((e) => e.source === 'main.py::main')
    expect(mainCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('does not create call edges for same-file calls', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const callEdges = edges.filter((e) => e.kind === 'call')
    // No call edge should have source and target in the same file
    for (const edge of callEdges) {
      const sourceFile = edge.source.split('::')[0]
      const targetFile = edge.target.split('::')[0]
      expect(sourceFile).not.toBe(targetFile)
    }
  })

  it('each edge has a unique id', () => {
    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const ids = edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
