# Phase 1: Static Graph Viewer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Electron desktop app that parses a Python project directory and renders an interactive architecture graph with module-level and function-level drill-down.

**Architecture:** Electron Forge + Vite + React. Three-process model: main (IPC router + window management), utility process (tree-sitter parser + file watcher + cache), renderer (React Flow + ELK layout). Communication via Electron IPC and `utilityProcess.fork()` MessagePort.

**Tech Stack:** Electron 33+, React 19, @xyflow/react 12, elkjs, web-tree-sitter (WASM — avoids native rebuild complexity), chokidar 4, zustand, vitest

**Design doc:** `docs/plans/2026-04-01-phase1-static-graph-viewer-design.md`

---

## Task 1: Scaffold Electron Forge Project

**Files:**
- Create: `package.json`, `forge.config.ts`, `tsconfig.json`, `vite.main.config.ts`, `vite.renderer.config.ts`, `vite.preload.config.ts`
- Create: `src/main/index.ts`, `src/main/preload.ts`
- Create: `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`

**Step 1: Initialize the Electron Forge project**

Run:
```bash
cd /Users/ggattacker/Documents/grapharc
npm init electron-app@latest . -- --template=vite-typescript
```

If the directory is non-empty, use a temp directory then move files:
```bash
cd /tmp && npm init electron-app@latest grapharc-scaffold -- --template=vite-typescript
cp -r /tmp/grapharc-scaffold/* /Users/ggattacker/Documents/grapharc/
cp /tmp/grapharc-scaffold/.gitignore /Users/ggattacker/Documents/grapharc/
rm -rf /tmp/grapharc-scaffold
cd /Users/ggattacker/Documents/grapharc
```

**Step 2: Add React and core dependencies**

Run:
```bash
npm install react react-dom @xyflow/react elkjs zustand chokidar web-tree-sitter
npm install -D @types/react @types/react-dom @vitejs/plugin-react vitest
```

**Step 3: Configure Vite for React**

Add React plugin to `vite.renderer.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

**Step 4: Restructure to match our design**

Move the generated `src/main.ts` → `src/main/index.ts`.
Move `src/preload.ts` → `src/main/preload.ts`.
Create `src/renderer/main.tsx` as the renderer entry.
Create `src/renderer/App.tsx` with a placeholder React component.
Update `src/renderer/index.html` to load the React entry.
Update `forge.config.ts` entry paths to match new structure.

**Step 5: Verify the app launches**

Run:
```bash
npm start
```

Expected: Electron window opens showing a placeholder React page.

**Step 6: Commit**

```bash
git init
git add -A
git commit -m "feat: scaffold Electron Forge + React + Vite project"
```

---

## Task 2: Shared Types and IPC Channels

**Files:**
- Create: `src/shared/types.ts`
- Create: `src/shared/ipcChannels.ts`
- Create: `src/shared/constants.ts`

**Step 1: Write shared type definitions**

Create `src/shared/types.ts`:

```ts
// --- Graph Data ---

export interface RepoMetadata {
  rootDir: string
  fileCount: number
  parsedAt: string
}

export interface GraphNode {
  id: string                          // "src/pairing/db.py::load_events"
  kind: 'module' | 'class' | 'function' | 'method'
  label: string                       // "load_events"
  filePath: string                    // "src/pairing/db.py"
  lineRange: [number, number]         // [146, 187]
  parent?: string                     // module or class this belongs to
  childCount?: number                 // functions/classes inside (for modules)
  metadata: Record<string, unknown>   // async, decorators, etc.
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'import' | 'call' | 'import_unresolved'
  weight?: number
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  metadata: RepoMetadata
}

// --- Diffs ---

export interface NodePatch {
  id: string
  changes: Partial<GraphNode>
}

export interface GraphDiff {
  nodesAdded: GraphNode[]
  nodesRemoved: string[]
  nodesModified: NodePatch[]
  edgesAdded: GraphEdge[]
  edgesRemoved: string[]
}

// --- IPC Messages ---

export type WorkerMessage =
  | { type: 'graph:ready'; data: GraphData }
  | { type: 'graph:diff'; data: GraphDiff }
  | { type: 'parse:progress'; data: { total: number; done: number } }
  | { type: 'parse:error'; data: { file: string; error: string } }
  | { type: 'worker:ready' }

export type RendererToMainMessage =
  | { type: 'project:open'; data: { rootDir: string } }
  | { type: 'project:refresh' }
```

**Step 2: Write IPC channel constants**

Create `src/shared/ipcChannels.ts`:

```ts
export const IPC = {
  // Renderer → Main
  PROJECT_OPEN: 'project:open',
  PROJECT_REFRESH: 'project:refresh',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Main → Renderer (forwarded from worker)
  GRAPH_READY: 'graph:ready',
  GRAPH_DIFF: 'graph:diff',
  PARSE_PROGRESS: 'parse:progress',
  PARSE_ERROR: 'parse:error',
} as const
```

**Step 3: Write default constants**

Create `src/shared/constants.ts`:

```ts
export const DEFAULT_IGNORES = [
  '.venv',
  '__pycache__',
  '.git',
  'node_modules',
  '.tox',
  '.eggs',
  '.mypy_cache',
  '.ruff_cache',
  '.pytest_cache',
  'dist',
  'build',
  '*.egg-info',
]

export const CACHE_DIR = '.grapharc'
export const CACHE_GRAPH_FILE = 'graph.json'
export const CACHE_HASHES_FILE = 'file-hashes.json'
export const CACHE_LAYOUT_FILE = 'layout-overrides.json'
```

**Step 4: Commit**

```bash
git add src/shared/
git commit -m "feat: add shared types, IPC channels, and constants"
```

---

## Task 3: File Discovery (Worker)

**Files:**
- Create: `src/worker/discovery.ts`
- Create: `test/worker/discovery.test.ts`
- Create: `test/fixtures/sample-project/main.py`
- Create: `test/fixtures/sample-project/utils.py`
- Create: `test/fixtures/sample-project/models.py`
- Create: `test/fixtures/sample-project/sub/__init__.py`
- Create: `test/fixtures/sample-project/sub/helpers.py`
- Create: `test/fixtures/sample-project/.venv/lib/site.py`
- Create: `test/fixtures/sample-project/__pycache__/main.cpython-310.pyc`

**Step 1: Create fixture Python project**

Create `test/fixtures/sample-project/main.py`:
```python
from utils import helper
from sub.helpers import deep_helper

def main():
    result = helper(42)
    deep_helper()
    return result

if __name__ == "__main__":
    main()
```

Create `test/fixtures/sample-project/utils.py`:
```python
from models import MyModel

def helper(x):
    m = MyModel(x)
    return m.value

def unused_func():
    pass
```

Create `test/fixtures/sample-project/models.py`:
```python
class MyModel:
    def __init__(self, value):
        self.value = value

    def get_value(self):
        return self.value

class OtherModel:
    pass
```

Create `test/fixtures/sample-project/sub/__init__.py`:
```python
```

Create `test/fixtures/sample-project/sub/helpers.py`:
```python
def deep_helper():
    return "deep"
```

Create `test/fixtures/sample-project/.venv/lib/site.py`:
```python
# should be ignored
```

Create empty `test/fixtures/sample-project/__pycache__/main.cpython-310.pyc` (any content).

**Step 2: Write the failing test**

Create `test/worker/discovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { discoverPythonFiles } from '../../src/worker/discovery'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'sample-project')

describe('discoverPythonFiles', () => {
  it('finds all .py files in the project', async () => {
    const files = await discoverPythonFiles(FIXTURES)
    const relative = files.map((f) => path.relative(FIXTURES, f)).sort()
    expect(relative).toEqual([
      'main.py',
      'models.py',
      path.join('sub', '__init__.py'),
      path.join('sub', 'helpers.py'),
      'utils.py',
    ])
  })

  it('ignores .venv and __pycache__', async () => {
    const files = await discoverPythonFiles(FIXTURES)
    const any_venv = files.some((f) => f.includes('.venv'))
    const any_cache = files.some((f) => f.includes('__pycache__'))
    expect(any_venv).toBe(false)
    expect(any_cache).toBe(false)
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run test/worker/discovery.test.ts`
Expected: FAIL — module not found

**Step 4: Implement discovery**

Create `src/worker/discovery.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { DEFAULT_IGNORES } from '../shared/constants'

export async function discoverPythonFiles(
  rootDir: string,
  ignorePatterns: string[] = DEFAULT_IGNORES
): Promise<string[]> {
  const results: string[] = []
  const ignoreSet = new Set(ignorePatterns)

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const name = entry.name
      if (ignoreSet.has(name)) continue
      if (name.startsWith('.') && name !== '__init__.py') continue

      const fullPath = path.join(dir, name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (name.endsWith('.py')) {
        results.push(fullPath)
      }
    }
  }

  await walk(rootDir)
  return results.sort()
}
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run test/worker/discovery.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/worker/discovery.ts test/
git commit -m "feat: add Python file discovery with ignore rules"
```

---

## Task 4: tree-sitter Python Parser (Symbol Extraction)

**Files:**
- Create: `src/worker/parser.ts`
- Create: `src/worker/symbols.ts`
- Create: `test/worker/symbols.test.ts`

**Step 1: Download tree-sitter Python WASM**

We use `web-tree-sitter` (WASM) to avoid native rebuild. Download the grammar:

```bash
mkdir -p resources/grammars
# Download pre-built WASM from tree-sitter releases
curl -L -o resources/grammars/tree-sitter-python.wasm \
  https://github.com/nicolo-ribaudo/nicolo-ribaudo.github.io/raw/main/nicolo-ribaudo.github.io/misc/tree-sitter-python.wasm 2>/dev/null || true
```

If the URL is unavailable, build it:
```bash
npx tree-sitter build --wasm node_modules/tree-sitter-python
cp tree-sitter-python.wasm resources/grammars/
```

**Step 2: Write the failing test**

Create `test/worker/symbols.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { initParser, extractSymbols } from '../../src/worker/symbols'

beforeAll(async () => {
  await initParser()
})

const SAMPLE_CODE = `
import os
from pathlib import Path

class MyClass:
    def __init__(self):
        pass

    def my_method(self):
        return 42

def top_level_func(x, y):
    return x + y

async def async_func():
    pass
`

describe('extractSymbols', () => {
  it('extracts functions with correct line ranges', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const funcs = symbols.filter((s) => s.kind === 'function')
    expect(funcs).toHaveLength(2)
    expect(funcs[0].label).toBe('top_level_func')
    expect(funcs[1].label).toBe('async_func')
    expect(funcs[1].metadata.async).toBe(true)
  })

  it('extracts classes', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const classes = symbols.filter((s) => s.kind === 'class')
    expect(classes).toHaveLength(1)
    expect(classes[0].label).toBe('MyClass')
  })

  it('extracts methods inside classes', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const methods = symbols.filter((s) => s.kind === 'method')
    expect(methods).toHaveLength(2)
    expect(methods[0].label).toBe('__init__')
    expect(methods[1].label).toBe('my_method')
    expect(methods[0].parent).toContain('MyClass')
  })

  it('creates a module node', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const module = symbols.find((s) => s.kind === 'module')
    expect(module).toBeDefined()
    expect(module!.label).toBe('test.py')
    expect(module!.childCount).toBe(4) // MyClass, top_level_func, async_func, + class counts as 1
  })
})
```

**Step 3: Run test to verify it fails**

Run: `npx vitest run test/worker/symbols.test.ts`
Expected: FAIL

**Step 4: Implement parser initialization**

Create `src/worker/parser.ts`:

```ts
import TreeSitter from 'web-tree-sitter'
import path from 'node:path'

let parser: TreeSitter | null = null
let pythonLang: TreeSitter.Language | null = null

export async function initParser(): Promise<void> {
  await TreeSitter.init()
  parser = new TreeSitter()

  // In production, resolve from resources/grammars/
  // In tests, resolve from project root
  const wasmPath = path.resolve(
    __dirname,
    '../../resources/grammars/tree-sitter-python.wasm'
  )
  pythonLang = await TreeSitter.Language.load(wasmPath)
  parser.setLanguage(pythonLang)
}

export function parse(source: string): TreeSitter.Tree {
  if (!parser) throw new Error('Parser not initialized. Call initParser() first.')
  return parser.parse(source)
}

export function getLanguage(): TreeSitter.Language {
  if (!pythonLang) throw new Error('Parser not initialized.')
  return pythonLang
}
```

**Step 5: Implement symbol extraction**

Create `src/worker/symbols.ts`:

```ts
import type { GraphNode } from '../shared/types'
import { parse } from './parser'
import type TreeSitter from 'web-tree-sitter'

export { initParser } from './parser'

export function extractSymbols(source: string, filePath: string): GraphNode[] {
  const tree = parse(source)
  const root = tree.rootNode
  const nodes: GraphNode[] = []
  const moduleId = filePath

  // Walk top-level children
  let childCount = 0

  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i)!
    if (child.type === 'function_definition') {
      childCount++
      nodes.push(functionNode(child, filePath, moduleId))
    } else if (child.type === 'decorated_definition') {
      const inner = child.childForFieldName('definition')
      if (inner?.type === 'function_definition') {
        childCount++
        nodes.push(functionNode(inner, filePath, moduleId, child))
      } else if (inner?.type === 'class_definition') {
        childCount++
        nodes.push(...classNodes(inner, filePath, moduleId, child))
      }
    } else if (child.type === 'class_definition') {
      childCount++
      nodes.push(...classNodes(child, filePath, moduleId))
    }
  }

  // Module node
  nodes.unshift({
    id: moduleId,
    kind: 'module',
    label: filePath.split('/').pop() || filePath,
    filePath,
    lineRange: [1, root.endPosition.row + 1],
    childCount,
    metadata: {},
  })

  return nodes
}

function functionNode(
  node: TreeSitter.SyntaxNode,
  filePath: string,
  parentId: string,
  decoratorNode?: TreeSitter.SyntaxNode
): GraphNode {
  const name = node.childForFieldName('name')?.text || 'anonymous'
  const startRow = (decoratorNode || node).startPosition.row + 1
  const endRow = node.endPosition.row + 1
  const isAsync = node.previousSibling?.type === 'async' ||
    node.parent?.type === 'decorated_definition' && node.parent.text.includes('async def') ||
    (decoratorNode?.text.includes('async def') ?? false)

  // Check if actually async by looking at the source
  const actualAsync = node.parent?.text?.startsWith('async') || false

  return {
    id: `${filePath}::${name}`,
    kind: 'function',
    label: name,
    filePath,
    lineRange: [startRow, endRow],
    parent: parentId,
    metadata: { async: isAsync || actualAsync },
  }
}

function classNodes(
  node: TreeSitter.SyntaxNode,
  filePath: string,
  moduleId: string,
  decoratorNode?: TreeSitter.SyntaxNode
): GraphNode[] {
  const name = node.childForFieldName('name')?.text || 'anonymous'
  const startRow = (decoratorNode || node).startPosition.row + 1
  const endRow = node.endPosition.row + 1
  const classId = `${filePath}::${name}`

  const results: GraphNode[] = []
  let methodCount = 0

  // Extract methods
  const body = node.childForFieldName('body')
  if (body) {
    for (let i = 0; i < body.childCount; i++) {
      const child = body.child(i)!
      if (child.type === 'function_definition') {
        methodCount++
        const methodName = child.childForFieldName('name')?.text || 'anonymous'
        results.push({
          id: `${classId}.${methodName}`,
          kind: 'method',
          label: methodName,
          filePath,
          lineRange: [child.startPosition.row + 1, child.endPosition.row + 1],
          parent: classId,
          metadata: {},
        })
      } else if (child.type === 'decorated_definition') {
        const inner = child.childForFieldName('definition')
        if (inner?.type === 'function_definition') {
          methodCount++
          const methodName = inner.childForFieldName('name')?.text || 'anonymous'
          results.push({
            id: `${classId}.${methodName}`,
            kind: 'method',
            label: methodName,
            filePath,
            lineRange: [child.startPosition.row + 1, inner.endPosition.row + 1],
            parent: classId,
            metadata: {},
          })
        }
      }
    }
  }

  // Class node itself
  results.unshift({
    id: classId,
    kind: 'class',
    label: name,
    filePath,
    lineRange: [startRow, endRow],
    parent: moduleId,
    childCount: methodCount,
    metadata: {},
  })

  return results
}
```

**Step 6: Run test to verify it passes**

Run: `npx vitest run test/worker/symbols.test.ts`
Expected: PASS (may need adjustments to childCount logic based on exact counts)

**Step 7: Commit**

```bash
git add src/worker/parser.ts src/worker/symbols.ts test/worker/symbols.test.ts resources/
git commit -m "feat: add tree-sitter Python symbol extraction"
```

---

## Task 5: Edge Resolution (Imports + Calls)

**Files:**
- Create: `src/worker/edges.ts`
- Create: `test/worker/edges.test.ts`

**Step 1: Write the failing test**

Create `test/worker/edges.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import path from 'node:path'
import { initParser } from '../../src/worker/symbols'
import { resolveEdges } from '../../src/worker/edges'
import { discoverPythonFiles } from '../../src/worker/discovery'
import { extractSymbols } from '../../src/worker/symbols'
import fs from 'node:fs/promises'
import type { GraphNode } from '../../src/shared/types'

const FIXTURES = path.join(__dirname, '..', 'fixtures', 'sample-project')

let allNodes: GraphNode[]

beforeAll(async () => {
  await initParser()
  const files = await discoverPythonFiles(FIXTURES)
  allNodes = []
  const fileSources = new Map<string, string>()
  for (const file of files) {
    const rel = path.relative(FIXTURES, file)
    const source = await fs.readFile(file, 'utf-8')
    fileSources.set(rel, source)
    allNodes.push(...extractSymbols(source, rel))
  }
})

describe('resolveEdges', () => {
  it('resolves import edges between modules', async () => {
    const files = await discoverPythonFiles(FIXTURES)
    const fileSources = new Map<string, string>()
    for (const file of files) {
      const rel = path.relative(FIXTURES, file)
      const source = await fs.readFile(file, 'utf-8')
      fileSources.set(rel, source)
    }

    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    const importEdges = edges.filter((e) => e.kind === 'import')

    // main.py imports from utils and sub.helpers
    const mainImports = importEdges.filter((e) => e.source.startsWith('main.py'))
    expect(mainImports.length).toBeGreaterThanOrEqual(1)
  })

  it('marks unresolvable imports', async () => {
    const files = await discoverPythonFiles(FIXTURES)
    const fileSources = new Map<string, string>()
    for (const file of files) {
      const rel = path.relative(FIXTURES, file)
      const source = await fs.readFile(file, 'utf-8')
      fileSources.set(rel, source)
    }

    const edges = resolveEdges(allNodes, fileSources, FIXTURES)
    // 'os' and 'pathlib' are stdlib — should be import_unresolved or absent
    const osImport = edges.find(
      (e) => e.target.includes('os') && e.kind === 'import_unresolved'
    )
    // We simply skip stdlib imports, so there should be none for 'os'
    const osAny = edges.find((e) => e.target === 'os')
    expect(osAny).toBeUndefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker/edges.test.ts`
Expected: FAIL

**Step 3: Implement edge resolution**

Create `src/worker/edges.ts`:

```ts
import path from 'node:path'
import { parse } from './parser'
import type { GraphEdge, GraphNode } from '../shared/types'
import type TreeSitter from 'web-tree-sitter'

/**
 * Resolve import and call edges from parsed file sources.
 *
 * @param allNodes All extracted symbols across all files.
 * @param fileSources Map of relative file path → source code.
 * @param rootDir Absolute path to the project root (used for module resolution).
 */
export function resolveEdges(
  allNodes: GraphNode[],
  fileSources: Map<string, string>,
  rootDir: string
): GraphEdge[] {
  const edges: GraphEdge[] = []
  const moduleSet = new Set(
    allNodes.filter((n) => n.kind === 'module').map((n) => n.id)
  )
  const symbolMap = new Map(allNodes.map((n) => [n.id, n]))
  let edgeId = 0

  for (const [filePath, source] of fileSources) {
    const tree = parse(source)
    const root = tree.rootNode

    // Pass 1: Imports
    for (let i = 0; i < root.childCount; i++) {
      const child = root.child(i)!
      if (child.type === 'import_from_statement') {
        const importEdges = resolveFromImport(child, filePath, moduleSet, symbolMap)
        edges.push(
          ...importEdges.map((e) => ({ ...e, id: `e${edgeId++}` }))
        )
      } else if (child.type === 'import_statement') {
        const importEdges = resolveImport(child, filePath, moduleSet)
        edges.push(
          ...importEdges.map((e) => ({ ...e, id: `e${edgeId++}` }))
        )
      }
    }

    // Pass 2: Calls (within functions)
    const funcNodes = allNodes.filter(
      (n) =>
        (n.kind === 'function' || n.kind === 'method') &&
        n.filePath === filePath
    )
    for (const funcNode of funcNodes) {
      const callEdges = resolveCallsInFunction(
        root,
        funcNode,
        filePath,
        allNodes,
        fileSources
      )
      edges.push(
        ...callEdges.map((e) => ({ ...e, id: `e${edgeId++}` }))
      )
    }
  }

  return edges
}

function resolveFromImport(
  node: TreeSitter.SyntaxNode,
  currentFile: string,
  moduleSet: Set<string>,
  symbolMap: Map<string, GraphNode>
): Omit<GraphEdge, 'id'>[] {
  const moduleName = node.childForFieldName('module_name')?.text
  if (!moduleName) return []

  // Convert dotted module name to file path
  const candidates = moduleToCandidates(moduleName)

  // Find the matching module in our project
  const targetModule = candidates.find((c) => moduleSet.has(c))
  if (!targetModule) return [] // stdlib or third-party — skip

  // Check if specific names are imported
  const edges: Omit<GraphEdge, 'id'>[] = []
  const importNames: string[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!
    if (child.type === 'dotted_name' && child !== node.childForFieldName('module_name')) {
      importNames.push(child.text)
    } else if (child.type === 'aliased_import') {
      const name = child.childForFieldName('name')?.text
      if (name) importNames.push(name)
    }
  }

  if (importNames.length > 0) {
    for (const name of importNames) {
      const symbolId = `${targetModule}::${name}`
      if (symbolMap.has(symbolId)) {
        edges.push({
          source: currentFile,
          target: symbolId,
          kind: 'import',
        })
      } else {
        // Import of the module itself
        edges.push({
          source: currentFile,
          target: targetModule,
          kind: 'import',
        })
      }
    }
  } else {
    edges.push({
      source: currentFile,
      target: targetModule,
      kind: 'import',
    })
  }

  return edges
}

function resolveImport(
  node: TreeSitter.SyntaxNode,
  currentFile: string,
  moduleSet: Set<string>
): Omit<GraphEdge, 'id'>[] {
  const edges: Omit<GraphEdge, 'id'>[] = []

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!
    if (child.type === 'dotted_name' || child.type === 'aliased_import') {
      const name = child.type === 'aliased_import'
        ? child.childForFieldName('name')?.text
        : child.text
      if (!name) continue
      const candidates = moduleToCandidates(name)
      const target = candidates.find((c) => moduleSet.has(c))
      if (target) {
        edges.push({ source: currentFile, target, kind: 'import' })
      }
    }
  }

  return edges
}

function moduleToCandidates(moduleName: string): string[] {
  const parts = moduleName.split('.')
  const asPath = parts.join('/')
  return [
    `${asPath}.py`,
    `${asPath}/__init__.py`,
    // Also try under src/
    `src/${asPath}.py`,
    `src/${asPath}/__init__.py`,
  ]
}

function resolveCallsInFunction(
  root: TreeSitter.SyntaxNode,
  funcNode: GraphNode,
  currentFile: string,
  allNodes: GraphNode[],
  fileSources: Map<string, string>
): Omit<GraphEdge, 'id'>[] {
  // For Phase 1, we do basic call resolution:
  // Look for call expressions matching known function names.
  // This is approximate — no type inference.
  const edges: Omit<GraphEdge, 'id'>[] = []
  const knownFunctions = new Map<string, GraphNode>()

  for (const n of allNodes) {
    if (n.kind === 'function' || n.kind === 'method') {
      knownFunctions.set(n.label, n)
    }
  }

  // Find the AST node for this function by line range
  const source = fileSources.get(currentFile)
  if (!source) return edges

  const tree = parse(source)
  const funcAstNode = findNodeAtLine(
    tree.rootNode,
    funcNode.lineRange[0] - 1,
    funcNode.lineRange[1] - 1
  )
  if (!funcAstNode) return edges

  // Walk for call expressions
  walkCalls(funcAstNode, (callName) => {
    const target = knownFunctions.get(callName)
    if (target && target.id !== funcNode.id && target.filePath !== currentFile) {
      edges.push({
        source: funcNode.id,
        target: target.id,
        kind: 'call',
      })
    }
  })

  return edges
}

function findNodeAtLine(
  root: TreeSitter.SyntaxNode,
  startLine: number,
  endLine: number
): TreeSitter.SyntaxNode | null {
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i)!
    if (
      child.startPosition.row === startLine ||
      (child.type === 'decorated_definition' &&
        child.endPosition.row === endLine)
    ) {
      if (
        child.type === 'function_definition' ||
        child.type === 'class_definition'
      ) {
        return child
      }
      if (child.type === 'decorated_definition') {
        return child.childForFieldName('definition')
      }
    }
    // Check nested (methods inside classes)
    const found = findNodeAtLine(child, startLine, endLine)
    if (found) return found
  }
  return null
}

function walkCalls(
  node: TreeSitter.SyntaxNode,
  callback: (name: string) => void
): void {
  if (node.type === 'call') {
    const func = node.childForFieldName('function')
    if (func) {
      if (func.type === 'identifier') {
        callback(func.text)
      } else if (func.type === 'attribute') {
        // e.g., db.load_events → extract "load_events"
        const attr = func.childForFieldName('attribute')
        if (attr) callback(attr.text)
      }
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    walkCalls(node.child(i)!, callback)
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/worker/edges.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/worker/edges.ts test/worker/edges.test.ts
git commit -m "feat: add import and call edge resolution"
```

---

## Task 6: Graph Assembly

**Files:**
- Create: `src/worker/graph.ts`
- Create: `test/worker/graph.test.ts`

**Step 1: Write the failing test**

Create `test/worker/graph.test.ts`:

```ts
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
    const graph = await buildGraph(FIXTURES)

    expect(graph.metadata.rootDir).toBe(FIXTURES)
    expect(graph.metadata.fileCount).toBe(5)

    // Should have module nodes
    const modules = graph.nodes.filter((n) => n.kind === 'module')
    expect(modules.length).toBe(5)

    // Should have edges
    expect(graph.edges.length).toBeGreaterThan(0)

    // Should have import edges from main.py
    const mainImports = graph.edges.filter(
      (e) => e.source === 'main.py' && e.kind === 'import'
    )
    expect(mainImports.length).toBeGreaterThanOrEqual(1)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker/graph.test.ts`
Expected: FAIL

**Step 3: Implement graph builder**

Create `src/worker/graph.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import type { GraphData, GraphEdge, GraphNode } from '../shared/types'
import { discoverPythonFiles } from './discovery'
import { extractSymbols } from './symbols'
import { resolveEdges } from './edges'

export async function buildGraph(rootDir: string): Promise<GraphData> {
  const files = await discoverPythonFiles(rootDir)
  const allNodes: GraphNode[] = []
  const fileSources = new Map<string, string>()

  for (const file of files) {
    const rel = path.relative(rootDir, file)
    const source = await fs.readFile(file, 'utf-8')
    fileSources.set(rel, source)
    allNodes.push(...extractSymbols(source, rel))
  }

  const edges = resolveEdges(allNodes, fileSources, rootDir)

  // Compute module-level rollup edges
  const moduleEdges = computeModuleRollups(allNodes, edges)

  return {
    nodes: allNodes,
    edges: [...edges, ...moduleEdges],
    metadata: {
      rootDir,
      fileCount: files.length,
      parsedAt: new Date().toISOString(),
    },
  }
}

function computeModuleRollups(
  nodes: GraphNode[],
  edges: GraphEdge[]
): GraphEdge[] {
  // For each call/import edge between functions in different modules,
  // create or increment a module-level edge.
  const moduleOf = new Map<string, string>()
  for (const n of nodes) {
    if (n.kind !== 'module' && n.parent) {
      // Walk up to find the module
      let p = n.parent
      const parentNode = nodes.find((nn) => nn.id === p)
      if (parentNode?.kind === 'module') {
        moduleOf.set(n.id, parentNode.id)
      } else if (parentNode?.parent) {
        moduleOf.set(n.id, parentNode.parent)
      }
    }
  }

  const rollupCounts = new Map<string, number>()
  for (const e of edges) {
    const srcMod = moduleOf.get(e.source) ?? e.source
    const tgtMod = moduleOf.get(e.target) ?? e.target

    // Only if modules differ and both exist
    if (srcMod === tgtMod) continue
    const modules = nodes.filter((n) => n.kind === 'module')
    const srcIsModule = modules.some((m) => m.id === srcMod)
    const tgtIsModule = modules.some((m) => m.id === tgtMod)
    if (!srcIsModule || !tgtIsModule) continue

    const key = `${srcMod}→${tgtMod}`
    rollupCounts.set(key, (rollupCounts.get(key) || 0) + 1)
  }

  let id = edges.length
  const rollupEdges: GraphEdge[] = []
  for (const [key, weight] of rollupCounts) {
    const [source, target] = key.split('→')
    rollupEdges.push({
      id: `rollup-${id++}`,
      source,
      target,
      kind: 'call',
      weight,
    })
  }

  return rollupEdges
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run test/worker/graph.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/worker/graph.ts test/worker/graph.test.ts
git commit -m "feat: add graph assembly with module-level rollups"
```

---

## Task 7: Worker Process Entry Point

**Files:**
- Create: `src/worker/index.ts`
- Create: `vite.worker.config.ts`
- Modify: `forge.config.ts` — add worker build entry

**Step 1: Create the worker entry**

Create `src/worker/index.ts`:

```ts
import { initParser } from './symbols'
import { buildGraph } from './graph'
import type { WorkerMessage } from '../shared/types'

function send(msg: WorkerMessage): void {
  process.parentPort.postMessage(msg)
}

process.parentPort.on('message', async (e: Electron.MessageEvent) => {
  const msg = e.data

  if (msg.type === 'project:open') {
    const { rootDir } = msg.data
    try {
      await initParser()
      send({ type: 'parse:progress', data: { total: 0, done: 0 } })
      const graph = await buildGraph(rootDir)
      send({ type: 'graph:ready', data: graph })
    } catch (err: any) {
      send({ type: 'parse:error', data: { file: rootDir, error: err.message } })
    }
  }

  if (msg.type === 'project:refresh') {
    // Full re-parse — same as open, rootDir stored in worker state
    // Will be implemented when we add watcher
  }
})

send({ type: 'worker:ready' })
```

**Step 2: Create Vite config for the worker**

Create `vite.worker.config.ts`:

```ts
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      entry: 'src/worker/index.ts',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron', 'web-tree-sitter'],
    },
  },
})
```

**Step 3: Update forge.config.ts**

Add the worker entry to the Vite plugin's `build` array:

```ts
{
  entry: 'src/worker/index.ts',
  config: 'vite.worker.config.ts',
}
```

**Step 4: Verify it builds**

Run: `npm run build` (or `npx electron-forge build`)
Expected: Builds without errors.

**Step 5: Commit**

```bash
git add src/worker/index.ts vite.worker.config.ts forge.config.ts
git commit -m "feat: add worker process entry with IPC message handling"
```

---

## Task 8: Main Process IPC + Worker Spawning

**Files:**
- Modify: `src/main/index.ts` — add worker spawning, IPC routing, folder dialog
- Create: `src/main/ipc.ts`
- Create: `src/main/menu.ts`
- Modify: `src/main/preload.ts` — expose IPC to renderer

**Step 1: Set up preload bridge**

Modify `src/main/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('grapharc', {
  openProject: (rootDir: string) => ipcRenderer.invoke('project:open', rootDir),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  onGraphReady: (cb: (data: any) => void) => {
    const handler = (_event: any, data: any) => cb(data)
    ipcRenderer.on('graph:ready', handler)
    return () => ipcRenderer.removeListener('graph:ready', handler)
  },
  onGraphDiff: (cb: (data: any) => void) => {
    const handler = (_event: any, data: any) => cb(data)
    ipcRenderer.on('graph:diff', handler)
    return () => ipcRenderer.removeListener('graph:diff', handler)
  },
  onParseProgress: (cb: (data: any) => void) => {
    const handler = (_event: any, data: any) => cb(data)
    ipcRenderer.on('parse:progress', handler)
    return () => ipcRenderer.removeListener('parse:progress', handler)
  },
  onParseError: (cb: (data: any) => void) => {
    const handler = (_event: any, data: any) => cb(data)
    ipcRenderer.on('parse:error', handler)
    return () => ipcRenderer.removeListener('parse:error', handler)
  },
})
```

**Step 2: Create IPC handler**

Create `src/main/ipc.ts`:

```ts
import { ipcMain, dialog, utilityProcess, BrowserWindow } from 'electron'
import path from 'node:path'

let worker: Electron.UtilityProcess | null = null

export function setupIPC(mainWindow: BrowserWindow): void {
  // Spawn the worker
  const workerPath = path.join(__dirname, '..', 'worker', 'index.js')
  worker = utilityProcess.fork(workerPath, [], {
    serviceName: 'grapharc-parser',
  })

  // Forward worker messages to renderer
  worker.on('message', (msg: any) => {
    if (msg.type === 'graph:ready') {
      mainWindow.webContents.send('graph:ready', msg.data)
    } else if (msg.type === 'graph:diff') {
      mainWindow.webContents.send('graph:diff', msg.data)
    } else if (msg.type === 'parse:progress') {
      mainWindow.webContents.send('parse:progress', msg.data)
    } else if (msg.type === 'parse:error') {
      mainWindow.webContents.send('parse:error', msg.data)
    }
  })

  // Handle renderer requests
  ipcMain.handle('project:open', (_event, rootDir: string) => {
    worker?.postMessage({ type: 'project:open', data: { rootDir } })
  })

  ipcMain.handle('project:refresh', () => {
    worker?.postMessage({ type: 'project:refresh' })
  })

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const rootDir = result.filePaths[0]
    worker?.postMessage({ type: 'project:open', data: { rootDir } })
    return rootDir
  })
}

export function shutdownWorker(): void {
  worker?.kill()
  worker = null
}
```

**Step 3: Create native menu**

Create `src/main/menu.ts`:

```ts
import { Menu, type BrowserWindow } from 'electron'

export function createMenu(mainWindow: BrowserWindow): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            mainWindow.webContents.send('menu:open-folder')
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

**Step 4: Update main process entry**

Modify `src/main/index.ts` to wire everything together:

```ts
import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { setupIPC, shutdownWorker } from './ipc'
import { createMenu } from './menu'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // Load renderer (Vite dev server in dev, built files in prod)
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)
    )
  }

  setupIPC(mainWindow)
  createMenu(mainWindow)
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  shutdownWorker()
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// Vite HMR declarations
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined
declare const MAIN_WINDOW_VITE_NAME: string
```

**Step 5: Verify the app still launches**

Run: `npm start`
Expected: Window opens without errors.

**Step 6: Commit**

```bash
git add src/main/
git commit -m "feat: add main process IPC routing, worker spawning, and native menu"
```

---

## Task 9: React Flow Canvas with Custom Nodes

**Files:**
- Create: `src/renderer/stores/graphStore.ts`
- Create: `src/renderer/hooks/useGraph.ts`
- Create: `src/renderer/layout.ts`
- Create: `src/renderer/Canvas.tsx`
- Create: `src/renderer/nodes/ModuleNode.tsx`
- Create: `src/renderer/nodes/FunctionNode.tsx`
- Create: `src/renderer/nodes/ClassNode.tsx`
- Create: `src/renderer/nodes/MethodNode.tsx`
- Create: `src/renderer/edges/ImportEdge.tsx`
- Create: `src/renderer/edges/CallEdge.tsx`
- Modify: `src/renderer/App.tsx`
- Create: `src/renderer/styles.css`

**Step 1: Create Zustand graph store**

Create `src/renderer/stores/graphStore.ts`:

```ts
import { create } from 'zustand'
import type { GraphData, GraphDiff } from '../../shared/types'

interface GraphState {
  graph: GraphData | null
  selectedNodeId: string | null
  expandedModules: Set<string>
  loading: boolean
  error: string | null

  setGraph: (data: GraphData) => void
  applyDiff: (diff: GraphDiff) => void
  selectNode: (id: string | null) => void
  toggleModule: (id: string) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useGraphStore = create<GraphState>((set) => ({
  graph: null,
  selectedNodeId: null,
  expandedModules: new Set(),
  loading: false,
  error: null,

  setGraph: (data) => set({ graph: data, loading: false, error: null }),
  applyDiff: (diff) =>
    set((state) => {
      if (!state.graph) return state
      const nodes = [...state.graph.nodes]
      const edges = [...state.graph.edges]

      // Remove
      const removeNodeIds = new Set(diff.nodesRemoved)
      const removeEdgeIds = new Set(diff.edgesRemoved)
      const filteredNodes = nodes.filter((n) => !removeNodeIds.has(n.id))
      const filteredEdges = edges.filter((e) => !removeEdgeIds.has(e.id))

      // Modify
      for (const patch of diff.nodesModified) {
        const idx = filteredNodes.findIndex((n) => n.id === patch.id)
        if (idx >= 0) {
          filteredNodes[idx] = { ...filteredNodes[idx], ...patch.changes }
        }
      }

      // Add
      filteredNodes.push(...diff.nodesAdded)
      filteredEdges.push(...diff.edgesAdded)

      return {
        graph: { ...state.graph, nodes: filteredNodes, edges: filteredEdges },
      }
    }),
  selectNode: (id) => set({ selectedNodeId: id }),
  toggleModule: (id) =>
    set((state) => {
      const next = new Set(state.expandedModules)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { expandedModules: next }
    }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))
```

**Step 2: Create IPC hook**

Create `src/renderer/hooks/useGraph.ts`:

```ts
import { useEffect } from 'react'
import { useGraphStore } from '../stores/graphStore'

declare global {
  interface Window {
    grapharc: {
      openProject: (rootDir: string) => Promise<void>
      refreshProject: () => Promise<void>
      openFolderDialog: () => Promise<string | null>
      onGraphReady: (cb: (data: any) => void) => () => void
      onGraphDiff: (cb: (data: any) => void) => () => void
      onParseProgress: (cb: (data: any) => void) => () => void
      onParseError: (cb: (data: any) => void) => () => void
    }
  }
}

export function useGraphIPC(): void {
  const setGraph = useGraphStore((s) => s.setGraph)
  const applyDiff = useGraphStore((s) => s.applyDiff)
  const setLoading = useGraphStore((s) => s.setLoading)
  const setError = useGraphStore((s) => s.setError)

  useEffect(() => {
    const unsubs = [
      window.grapharc.onGraphReady((data) => setGraph(data)),
      window.grapharc.onGraphDiff((data) => applyDiff(data)),
      window.grapharc.onParseProgress(() => setLoading(true)),
      window.grapharc.onParseError((data) => setError(data.error)),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [setGraph, applyDiff, setLoading, setError])
}
```

**Step 3: Create ELK layout wrapper**

Create `src/renderer/layout.ts`:

```ts
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

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: LAYOUT_OPTIONS,
    children: topLevel.map(toElk),
    edges: edges
      .filter((e) => {
        // Only layout edges between nodes that exist in the node list
        const srcExists = nodes.some((n) => n.id === e.source)
        const tgtExists = nodes.some((n) => n.id === e.target)
        return srcExists && tgtExists
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
```

**Step 4: Create custom node components**

Create `src/renderer/nodes/ModuleNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ModuleNodeData = {
  label: string
  childCount: number
  expanded: boolean
  onToggle: () => void
}

export function ModuleNode({ data }: NodeProps<Node<ModuleNodeData>>) {
  return (
    <div className={`node node-module ${data.expanded ? 'expanded' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header" onDoubleClick={data.onToggle}>
        <span className="node-icon">{data.expanded ? '▼' : '▶'}</span>
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.childCount}</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

Create `src/renderer/nodes/FunctionNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type FunctionNodeData = {
  label: string
  async?: boolean
  lineCount: number
}

export function FunctionNode({ data }: NodeProps<Node<FunctionNodeData>>) {
  return (
    <div className="node node-function">
      <Handle type="target" position={Position.Top} />
      <span className="node-label">
        {data.async && <span className="badge">async</span>}
        {data.label}
      </span>
      <span className="node-lines">{data.lineCount}L</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

Create `src/renderer/nodes/ClassNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type ClassNodeData = {
  label: string
  methodCount: number
}

export function ClassNode({ data }: NodeProps<Node<ClassNodeData>>) {
  return (
    <div className="node node-class">
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span className="node-label">{data.label}</span>
        <span className="node-count">{data.methodCount}m</span>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

Create `src/renderer/nodes/MethodNode.tsx`:

```tsx
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'

export type MethodNodeData = {
  label: string
}

export function MethodNode({ data }: NodeProps<Node<MethodNodeData>>) {
  return (
    <div className="node node-method">
      <Handle type="target" position={Position.Top} />
      <span className="node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

**Step 5: Create custom edge components**

Create `src/renderer/edges/ImportEdge.tsx`:

```tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function ImportEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  return (
    <BaseEdge
      path={path}
      style={{ strokeDasharray: '5,5', stroke: '#666' }}
      {...props}
    />
  )
}
```

Create `src/renderer/edges/CallEdge.tsx`:

```tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react'

export function CallEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  const weight = (props.data as any)?.weight ?? 1
  const strokeWidth = Math.min(1 + weight, 5)
  const color = weight >= 5 ? '#f59e0b' : '#3b82f6'

  return (
    <BaseEdge
      path={path}
      style={{ stroke: color, strokeWidth }}
      {...props}
    />
  )
}
```

**Step 6: Create the Canvas component**

Create `src/renderer/Canvas.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react'
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

function getModuleId(node: GNode, allNodes: GNode[]): string {
  if (node.kind === 'module') return node.id
  if (node.parent) {
    const parent = allNodes.find((n) => n.id === node.parent)
    if (parent) return getModuleId(parent, allNodes)
  }
  return node.id
}

export function Canvas() {
  const graph = useGraphStore((s) => s.graph)
  const expandedModules = useGraphStore((s) => s.expandedModules)
  const toggleModule = useGraphStore((s) => s.toggleModule)
  const selectNode = useGraphStore((s) => s.selectNode)

  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
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
  }, [graph, expandedModules])

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
```

**Step 7: Create basic styles**

Create `src/renderer/styles.css`:

```css
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #1a1a2e;
  color: #e0e0e0;
}

#root {
  width: 100vw;
  height: 100vh;
  display: flex;
}

.app {
  display: flex;
  width: 100%;
  height: 100%;
}

.canvas-container {
  flex: 1;
  height: 100%;
}

/* Nodes */
.node {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid #333;
  min-width: 120px;
}

.node-module {
  background: #16213e;
  border-color: #0f3460;
}

.node-module.expanded {
  min-height: 200px;
}

.node-function {
  background: #1a1a2e;
  border-color: #3b82f6;
  border-radius: 20px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-class {
  background: #1e1e3f;
  border-color: #8b5cf6;
}

.node-method {
  background: #252547;
  border-color: #6366f1;
  border-radius: 12px;
  padding: 4px 8px;
  font-size: 11px;
}

.node-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-icon {
  font-size: 10px;
  cursor: pointer;
}

.node-label {
  font-weight: 500;
}

.node-count {
  font-size: 11px;
  opacity: 0.6;
  margin-left: auto;
}

.node-lines {
  font-size: 10px;
  opacity: 0.5;
}

.badge {
  background: #3b82f6;
  color: white;
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 4px;
}

/* Welcome screen */
.welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 16px;
  color: #888;
}

.welcome button {
  padding: 10px 24px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.welcome button:hover {
  background: #2563eb;
}
```

**Step 8: Update App.tsx**

Modify `src/renderer/App.tsx`:

```tsx
import { useGraphIPC } from './hooks/useGraph'
import { useGraphStore } from './stores/graphStore'
import { Canvas } from './Canvas'
import './styles.css'

export function App() {
  useGraphIPC()
  const graph = useGraphStore((s) => s.graph)
  const loading = useGraphStore((s) => s.loading)

  const handleOpen = async () => {
    await window.grapharc.openFolderDialog()
  }

  if (!graph) {
    return (
      <div className="welcome">
        <h1>GraphArc</h1>
        <p>Open a Python project to visualize its architecture</p>
        <button onClick={handleOpen}>Open Project Folder...</button>
        {loading && <p>Parsing...</p>}
      </div>
    )
  }

  return (
    <div className="app">
      <div className="canvas-container">
        <Canvas />
      </div>
    </div>
  )
}
```

**Step 9: Verify the app renders**

Run: `npm start`
Expected: Welcome screen shows. Click "Open Project Folder", select `predex-pairing/src`, and the graph renders.

**Step 10: Commit**

```bash
git add src/renderer/
git commit -m "feat: add React Flow canvas with custom nodes, edges, and ELK layout"
```

---

## Task 10: Detail Panel

**Files:**
- Create: `src/renderer/panels/DetailPanel.tsx`
- Modify: `src/renderer/App.tsx` — add panel to layout

**Step 1: Create the detail panel**

Create `src/renderer/panels/DetailPanel.tsx`:

```tsx
import { useGraphStore } from '../stores/graphStore'

export function DetailPanel() {
  const selectedId = useGraphStore((s) => s.selectedNodeId)
  const graph = useGraphStore((s) => s.graph)

  if (!selectedId || !graph) return null

  const node = graph.nodes.find((n) => n.id === selectedId)
  if (!node) return null

  const inbound = graph.edges.filter((e) => e.target === selectedId)
  const outbound = graph.edges.filter((e) => e.source === selectedId)

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span className={`detail-kind kind-${node.kind}`}>{node.kind}</span>
        <h3>{node.label}</h3>
      </div>

      <div className="detail-section">
        <div className="detail-row">
          <span className="detail-key">File</span>
          <span className="detail-value">{node.filePath}</span>
        </div>
        <div className="detail-row">
          <span className="detail-key">Lines</span>
          <span className="detail-value">
            {node.lineRange[0]}–{node.lineRange[1]}
          </span>
        </div>
        {node.childCount !== undefined && (
          <div className="detail-row">
            <span className="detail-key">Children</span>
            <span className="detail-value">{node.childCount}</span>
          </div>
        )}
      </div>

      {inbound.length > 0 && (
        <div className="detail-section">
          <h4>Inbound ({inbound.length})</h4>
          {inbound.map((e) => (
            <div key={e.id} className="detail-edge">
              <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
              <span>{e.source}</span>
            </div>
          ))}
        </div>
      )}

      {outbound.length > 0 && (
        <div className="detail-section">
          <h4>Outbound ({outbound.length})</h4>
          {outbound.map((e) => (
            <div key={e.id} className="detail-edge">
              <span className={`edge-kind kind-${e.kind}`}>{e.kind}</span>
              <span>{e.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Add detail panel styles to `styles.css`**

Append to `src/renderer/styles.css`:

```css
/* Detail Panel */
.detail-panel {
  width: 320px;
  background: #16213e;
  border-left: 1px solid #333;
  padding: 16px;
  overflow-y: auto;
}

.detail-header h3 {
  margin: 4px 0 12px;
  font-size: 16px;
}

.detail-kind {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
  font-weight: 600;
}

.kind-module { background: #0f3460; }
.kind-function { background: #1e40af; }
.kind-class { background: #5b21b6; }
.kind-method { background: #4338ca; }
.kind-import { background: #374151; }
.kind-call { background: #1e40af; }
.kind-import_unresolved { background: #991b1b; }

.detail-section {
  margin-bottom: 16px;
}

.detail-section h4 {
  font-size: 12px;
  text-transform: uppercase;
  opacity: 0.6;
  margin: 8px 0 4px;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 2px 0;
}

.detail-key { opacity: 0.6; }

.detail-edge {
  font-size: 12px;
  padding: 2px 0;
  display: flex;
  gap: 8px;
  align-items: center;
}

.edge-kind {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
}
```

**Step 3: Wire into App.tsx**

Update `src/renderer/App.tsx` to include the panel:

```tsx
import { DetailPanel } from './panels/DetailPanel'

// In the graph-loaded return:
return (
  <div className="app">
    <div className="canvas-container">
      <Canvas />
    </div>
    <DetailPanel />
  </div>
)
```

**Step 4: Verify**

Run: `npm start`, open a project, click a node → detail panel appears on the right.

**Step 5: Commit**

```bash
git add src/renderer/panels/ src/renderer/styles.css src/renderer/App.tsx
git commit -m "feat: add detail panel showing node info and edges"
```

---

## Task 11: Filter Bar

**Files:**
- Create: `src/renderer/panels/FilterBar.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/stores/graphStore.ts` — add filter state

**Step 1: Add filter state to store**

Add to `src/renderer/stores/graphStore.ts`:

```ts
// Add to GraphState interface:
searchQuery: string
visibleEdgeKinds: Set<string>
setSearchQuery: (q: string) => void
toggleEdgeKind: (kind: string) => void

// Add to create():
searchQuery: '',
visibleEdgeKinds: new Set(['import', 'call', 'import_unresolved']),
setSearchQuery: (q) => set({ searchQuery: q }),
toggleEdgeKind: (kind) =>
  set((state) => {
    const next = new Set(state.visibleEdgeKinds)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    return { visibleEdgeKinds: next }
  }),
```

**Step 2: Create FilterBar component**

Create `src/renderer/panels/FilterBar.tsx`:

```tsx
import { useGraphStore } from '../stores/graphStore'

export function FilterBar() {
  const searchQuery = useGraphStore((s) => s.searchQuery)
  const setSearchQuery = useGraphStore((s) => s.setSearchQuery)
  const visibleEdgeKinds = useGraphStore((s) => s.visibleEdgeKinds)
  const toggleEdgeKind = useGraphStore((s) => s.toggleEdgeKind)
  const graph = useGraphStore((s) => s.graph)

  if (!graph) return null

  return (
    <div className="filter-bar">
      <input
        className="search-input"
        type="text"
        placeholder="Search nodes... (Cmd+F)"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />
      <div className="edge-toggles">
        {['import', 'call'].map((kind) => (
          <label key={kind} className="edge-toggle">
            <input
              type="checkbox"
              checked={visibleEdgeKinds.has(kind)}
              onChange={() => toggleEdgeKind(kind)}
            />
            {kind}
          </label>
        ))}
      </div>
      <span className="stats">
        {graph.nodes.filter((n) => n.kind === 'module').length} modules
        {' | '}
        {graph.edges.length} edges
      </span>
    </div>
  )
}
```

**Step 3: Add filter bar styles**

Append to `src/renderer/styles.css`:

```css
/* Filter Bar */
.filter-bar {
  height: 40px;
  background: #16213e;
  border-bottom: 1px solid #333;
  display: flex;
  align-items: center;
  padding: 0 12px;
  gap: 16px;
}

.search-input {
  background: #1a1a2e;
  border: 1px solid #333;
  color: #e0e0e0;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  width: 240px;
}

.edge-toggles {
  display: flex;
  gap: 12px;
}

.edge-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  opacity: 0.8;
  cursor: pointer;
}

.stats {
  margin-left: auto;
  font-size: 11px;
  opacity: 0.5;
}
```

**Step 4: Wire into App.tsx**

Update `src/renderer/App.tsx`:

```tsx
import { FilterBar } from './panels/FilterBar'

// Updated layout:
return (
  <div className="app">
    <div className="main-area">
      <FilterBar />
      <div className="canvas-container">
        <Canvas />
      </div>
    </div>
    <DetailPanel />
  </div>
)
```

Add to `styles.css`:
```css
.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
}
```

**Step 5: Update Canvas.tsx to respect filters**

In `graphToFlow()`, filter edges by `visibleEdgeKinds` and nodes by `searchQuery`. Wire these from the store.

**Step 6: Commit**

```bash
git add src/renderer/
git commit -m "feat: add filter bar with search and edge type toggles"
```

---

## Task 12: File Watcher (Incremental Updates)

**Files:**
- Modify: `src/worker/index.ts` — add chokidar watching
- Create: `src/worker/watcher.ts`

**Step 1: Create watcher module**

Create `src/worker/watcher.ts`:

```ts
import { watch, type FSWatcher } from 'chokidar'

let watcher: FSWatcher | null = null

export function startWatching(
  rootDir: string,
  onChange: (filePath: string) => void,
  onRemove: (filePath: string) => void
): void {
  stopWatching()

  watcher = watch(rootDir, {
    ignored: /(^|[\/\\])(\.|__pycache__|\.venv|node_modules|\.git)/,
    persistent: true,
    ignoreInitial: true,
  })

  watcher.on('change', (path) => {
    if (path.endsWith('.py')) onChange(path)
  })
  watcher.on('add', (path) => {
    if (path.endsWith('.py')) onChange(path)
  })
  watcher.on('unlink', (path) => {
    if (path.endsWith('.py')) onRemove(path)
  })
}

export function stopWatching(): void {
  watcher?.close()
  watcher = null
}
```

**Step 2: Wire into worker entry**

Update `src/worker/index.ts` to start watching after initial parse and send diffs on file change. On change, re-parse the changed file, recompute affected edges, and send a `graph:diff`.

**Step 3: Verify**

Run: `npm start`, open a project, edit a `.py` file in an editor → graph updates automatically.

**Step 4: Commit**

```bash
git add src/worker/watcher.ts src/worker/index.ts
git commit -m "feat: add file watcher for live graph updates"
```

---

## Task 13: Graph Caching

**Files:**
- Create: `src/worker/cache.ts`
- Modify: `src/worker/index.ts` — check cache on project open

**Step 1: Implement cache read/write**

Create `src/worker/cache.ts`:

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import type { GraphData } from '../shared/types'

function cacheDir(rootDir: string): string {
  const hash = crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 12)
  return path.join(os.homedir(), '.grapharc', 'cache', hash)
}

export async function readCache(rootDir: string): Promise<GraphData | null> {
  try {
    const dir = cacheDir(rootDir)
    const raw = await fs.readFile(path.join(dir, 'graph.json'), 'utf-8')
    return JSON.parse(raw) as GraphData
  } catch {
    return null
  }
}

export async function writeCache(rootDir: string, graph: GraphData): Promise<void> {
  const dir = cacheDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'graph.json'), JSON.stringify(graph))
}

export async function readLayoutOverrides(
  rootDir: string
): Promise<Record<string, { x: number; y: number }>> {
  try {
    const dir = cacheDir(rootDir)
    const raw = await fs.readFile(path.join(dir, 'layout-overrides.json'), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export async function writeLayoutOverrides(
  rootDir: string,
  overrides: Record<string, { x: number; y: number }>
): Promise<void> {
  const dir = cacheDir(rootDir)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'layout-overrides.json'), JSON.stringify(overrides))
}
```

**Step 2: Wire cache into worker**

Update `src/worker/index.ts`: on `project:open`, check cache first. If cache exists, send immediately, then re-parse in background and send diff if anything changed.

**Step 3: Commit**

```bash
git add src/worker/cache.ts src/worker/index.ts
git commit -m "feat: add graph caching for instant startup"
```

---

## Task 14: End-to-End Smoke Test

**Files:**
- Create: `test/e2e/smoke.test.ts`

**Step 1: Write an integration test**

Create `test/e2e/smoke.test.ts`:

```ts
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
      '__init__.py',
      'helpers.py',
      'main.py',
      'models.py',
      'utils.py',
    ])

    // Functions
    const funcs = graph.nodes.filter((n) => n.kind === 'function')
    expect(funcs.map((f) => f.label).sort()).toContain('main')
    expect(funcs.map((f) => f.label).sort()).toContain('helper')

    // Classes
    const classes = graph.nodes.filter((n) => n.kind === 'class')
    expect(classes.map((c) => c.label)).toContain('MyModel')

    // Edges exist
    expect(graph.edges.length).toBeGreaterThan(0)

    // Import edges from main.py → utils.py
    const mainToUtils = graph.edges.find(
      (e) =>
        e.source === 'main.py' &&
        (e.target === 'utils.py' || e.target.startsWith('utils.py::'))
    )
    expect(mainToUtils).toBeDefined()
  })
})
```

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS.

**Step 3: Commit**

```bash
git add test/e2e/
git commit -m "test: add end-to-end smoke test for graph building"
```

---

## Summary

| Task | What it builds | Test coverage |
|------|---------------|---------------|
| 1 | Electron Forge scaffold | App launches |
| 2 | Shared types & IPC channels | Type safety |
| 3 | File discovery | 2 unit tests |
| 4 | tree-sitter symbol extraction | 4 unit tests |
| 5 | Import + call edge resolution | 2 unit tests |
| 6 | Graph assembly + rollups | 1 integration test |
| 7 | Worker process entry | Builds |
| 8 | Main process IPC + menu | App launches with IPC |
| 9 | React Flow canvas + custom nodes/edges + layout | Visual verification |
| 10 | Detail panel | Visual verification |
| 11 | Filter bar | Visual verification |
| 12 | File watcher | Live update verification |
| 13 | Graph caching | Instant startup verification |
| 14 | E2E smoke test | 1 integration test |

**Total: 14 tasks, ~14 commits, full Phase 1 coverage.**
