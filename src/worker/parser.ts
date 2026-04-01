import {
  Parser,
  Language,
  type Tree,
} from 'web-tree-sitter'
import path from 'node:path'
import fs from 'node:fs'

export type { Tree }

let parser: Parser | null = null

/**
 * Find a WASM file by searching multiple candidate paths.
 * Checks relative to __dirname (works in both vitest and Electron bundle).
 */
function findWasm(filename: string, searchDirs: string[]): string {
  const candidates: string[] = []
  for (const dir of searchDirs) {
    candidates.push(path.resolve(dir, filename))
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    `${filename} not found. Searched:\n${candidates.join('\n')}`
  )
}

/**
 * Initialize web-tree-sitter and load the Python grammar.
 * Safe to call multiple times -- subsequent calls are no-ops.
 *
 * Resolves WASM paths for both the tree-sitter runtime and the
 * Python grammar, searching relative to __dirname (handles both
 * vitest and Electron Forge Vite bundle contexts).
 */
export async function initParser(): Promise<void> {
  if (parser) return

  // Candidate directories to search for WASM files.
  // In vitest: __dirname = src/worker/ → ../../ = project root
  // In Electron bundle: __dirname = .vite/build/ → ../../ = project root
  const projectRoot = path.resolve(__dirname, '..', '..')
  const searchDirs = [
    path.join(projectRoot, 'node_modules', 'web-tree-sitter'),
    path.join(projectRoot, 'resources', 'grammars'),
    path.join(projectRoot, 'node_modules', 'tree-sitter-python'),
    __dirname,  // fallback: same dir as the built worker
  ]

  // web-tree-sitter needs its own WASM file for the runtime
  const runtimeWasm = findWasm('web-tree-sitter.wasm', searchDirs)

  // Parser.init() accepts a moduleOptions object with locateFile
  // to tell it where to find web-tree-sitter.wasm
  await Parser.init({
    locateFile: (scriptName: string) => {
      if (scriptName === 'tree-sitter.wasm' || scriptName.includes('web-tree-sitter')) {
        return runtimeWasm
      }
      return scriptName
    },
  })

  // Load the Python grammar WASM
  const grammarPath = findWasm('tree-sitter-python.wasm', searchDirs)
  const pythonLang = await Language.load(grammarPath)

  parser = new Parser()
  parser.setLanguage(pythonLang)
}

/**
 * Parse Python source code into a tree-sitter AST.
 * `initParser()` must be called before this function.
 */
export function parse(source: string): Tree {
  if (!parser) {
    throw new Error('Parser not initialized. Call initParser() first.')
  }
  const tree = parser.parse(source)
  if (!tree) {
    throw new Error('Failed to parse source code.')
  }
  return tree
}
