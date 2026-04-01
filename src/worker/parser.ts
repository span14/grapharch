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
 * Resolve the path to the tree-sitter-python WASM grammar.
 *
 * Search order:
 *  1. resources/grammars/tree-sitter-python.wasm (project root)
 *  2. node_modules/tree-sitter-python/tree-sitter-python.wasm
 */
function resolveGrammarPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'resources', 'grammars', 'tree-sitter-python.wasm'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'tree-sitter-python', 'tree-sitter-python.wasm'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  throw new Error(
    `tree-sitter-python.wasm not found. Searched:\n${candidates.join('\n')}`
  )
}

/**
 * Initialize web-tree-sitter and load the Python grammar.
 * Safe to call multiple times -- subsequent calls are no-ops.
 */
export async function initParser(): Promise<void> {
  if (parser) return

  await Parser.init()

  const grammarPath = resolveGrammarPath()
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
