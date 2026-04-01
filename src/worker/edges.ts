import type { Node as TSNode } from 'web-tree-sitter'
import type { GraphNode, GraphEdge } from '../shared/types'
import { parse } from './parser'

/**
 * Convert a dotted module name into candidate relative file paths.
 *
 * E.g. "utils"       -> ["utils.py", "utils/__init__.py"]
 *      "sub.helpers"  -> ["sub/helpers.py", "sub/helpers/__init__.py"]
 */
function moduleToCandidates(moduleName: string): string[] {
  const parts = moduleName.split('.')
  const base = parts.join('/')
  return [`${base}.py`, `${base}/__init__.py`]
}

/**
 * Recursively walk an AST subtree, yielding every node of the given type(s).
 */
function walkTree(node: TSNode, types: Set<string>): TSNode[] {
  const result: TSNode[] = []
  if (types.has(node.type)) {
    result.push(node)
  }
  for (const child of node.children) {
    result.push(...walkTree(child, types))
  }
  return result
}

/**
 * Extract the dotted module name from an import_statement or import_from_statement.
 *
 * import_statement:       "import foo.bar"       -> "foo.bar"
 * import_from_statement:  "from foo.bar import X" -> "foo.bar"
 */
function getModuleName(node: TSNode): string | null {
  if (node.type === 'import_statement') {
    // Children: "import" keyword, then dotted_name or aliased_import
    const nameNode = node.childForFieldName('name')
    if (nameNode) return nameNode.text
    // Fallback: find the dotted_name child
    for (const child of node.children) {
      if (child.type === 'dotted_name') return child.text
      if (child.type === 'aliased_import') {
        const inner = child.childForFieldName('name')
        if (inner) return inner.text
        for (const c of child.children) {
          if (c.type === 'dotted_name') return c.text
        }
      }
    }
  }

  if (node.type === 'import_from_statement') {
    const moduleNode = node.childForFieldName('module_name')
    if (moduleNode) return moduleNode.text
    // Fallback: find the dotted_name child that appears after "from"
    let sawFrom = false
    for (const child of node.children) {
      if (child.type === 'from') { sawFrom = true; continue }
      if (!child.isNamed && child.text === 'from') { sawFrom = true; continue }
      if (sawFrom && (child.type === 'dotted_name' || child.type === 'relative_import')) {
        return child.text
      }
    }
  }

  return null
}

/**
 * For `from X import Y, Z`, extract the imported names.
 */
function getImportedNames(node: TSNode): string[] {
  if (node.type !== 'import_from_statement') return []

  const names: string[] = []
  // Look for children after 'import' keyword
  let sawImport = false
  for (const child of node.children) {
    if (!child.isNamed && child.text === 'import') {
      sawImport = true
      continue
    }
    if (sawImport) {
      if (child.type === 'dotted_name') {
        names.push(child.text)
      } else if (child.type === 'aliased_import') {
        const nameChild = child.childForFieldName('name')
        if (nameChild) names.push(nameChild.text)
        else {
          for (const c of child.children) {
            if (c.type === 'dotted_name' || c.type === 'identifier') {
              names.push(c.text)
              break
            }
          }
        }
      } else if (child.type === 'identifier') {
        names.push(child.text)
      }
    }
  }
  return names
}

/**
 * Extract all call names from an AST node (recursively).
 * Returns both simple calls (e.g. "helper") and attribute calls (e.g. "load_events" from "db.load_events").
 */
function extractCallNames(node: TSNode): string[] {
  const callNodes = walkTree(node, new Set(['call']))
  const names: string[] = []

  for (const callNode of callNodes) {
    const funcNode = callNode.childForFieldName('function')
    if (!funcNode) continue

    if (funcNode.type === 'identifier') {
      names.push(funcNode.text)
    } else if (funcNode.type === 'attribute') {
      // e.g. db.load_events -> extract "load_events"
      const attrNode = funcNode.childForFieldName('attribute')
      if (attrNode) {
        names.push(attrNode.text)
      }
    }
  }

  return names
}

let edgeCounter = 0

function makeEdgeId(kind: string): string {
  edgeCounter++
  return `edge-${kind}-${edgeCounter}`
}

/**
 * Resolve import and call edges from extracted symbols and source files.
 *
 * @param allNodes - All extracted GraphNode[] from the project
 * @param fileSources - Map of relative filePath to source code
 * @param rootDir - The project root directory (not used for file matching, but for context)
 * @returns GraphEdge[] of resolved import and call edges
 */
export function resolveEdges(
  allNodes: GraphNode[],
  fileSources: Map<string, string>,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rootDir: string
): GraphEdge[] {
  // Reset edge counter for deterministic behavior in tests
  edgeCounter = 0

  const edges: GraphEdge[] = []

  // Build lookup structures
  const knownModules = new Set<string>()       // set of relative file paths that are modules
  const symbolsByName = new Map<string, GraphNode[]>()  // functionName -> [nodes across files]

  for (const node of allNodes) {
    if (node.kind === 'module') {
      knownModules.add(node.filePath)
    }
    if (node.kind === 'function' || node.kind === 'method' || node.kind === 'class') {
      const existing = symbolsByName.get(node.label) ?? []
      existing.push(node)
      symbolsByName.set(node.label, existing)
    }
  }

  // Dedup helper for edges
  const seenEdges = new Set<string>()

  function addEdge(edge: GraphEdge): void {
    const key = `${edge.source}|${edge.target}|${edge.kind}`
    if (seenEdges.has(key)) return
    seenEdges.add(key)
    edges.push(edge)
  }

  // Process each file
  for (const [filePath, source] of fileSources) {
    const tree = parse(source)
    const root = tree.rootNode

    // --- Pass 1: Imports ---
    const importNodes = walkTree(root, new Set(['import_statement', 'import_from_statement']))

    for (const importNode of importNodes) {
      const moduleName = getModuleName(importNode)
      if (!moduleName) continue

      // Skip relative imports that start with dots (we don't resolve those)
      if (moduleName.startsWith('.')) continue

      // Generate candidate file paths
      const candidates = moduleToCandidates(moduleName)

      // Find matching module in the project
      const matchedModule = candidates.find((c) => knownModules.has(c))
      if (!matchedModule) continue // stdlib or third-party -- skip

      // For `from X import Y`, check if Y is a known symbol in the target module
      if (importNode.type === 'import_from_statement') {
        const importedNames = getImportedNames(importNode)

        for (const name of importedNames) {
          // Check if name matches a known symbol in the matched module
          const candidates = symbolsByName.get(name)
          const matchedSymbol = candidates?.find((s) => s.filePath === matchedModule)

          if (matchedSymbol) {
            // Create edge to the specific symbol
            addEdge({
              id: makeEdgeId('import'),
              source: filePath,
              target: matchedSymbol.id,
              kind: 'import',
            })
          } else {
            // Create edge to the module
            addEdge({
              id: makeEdgeId('import'),
              source: filePath,
              target: matchedModule,
              kind: 'import',
            })
          }
        }
      } else {
        // Plain `import X` -> edge to the module
        addEdge({
          id: makeEdgeId('import'),
          source: filePath,
          target: matchedModule,
          kind: 'import',
        })
      }
    }

    // --- Pass 2: Calls ---
    // Walk function bodies for call nodes
    const funcDefs = walkTree(root, new Set(['function_definition']))

    for (const funcDef of funcDefs) {
      const nameNode = funcDef.childForFieldName('name')
      if (!nameNode) continue

      const bodyNode = funcDef.childForFieldName('body')
      if (!bodyNode) continue

      // Determine the calling symbol's id
      // We need to figure out if this is a top-level function or a method
      const funcName = nameNode.text
      const callerCandidates = allNodes.filter(
        (n) =>
          n.filePath === filePath &&
          n.label === funcName &&
          (n.kind === 'function' || n.kind === 'method')
      )
      const caller = callerCandidates.length > 0 ? callerCandidates[0] : null
      if (!caller) continue

      const callNames = extractCallNames(bodyNode)

      for (const callName of callNames) {
        const targetSymbols = symbolsByName.get(callName)
        if (!targetSymbols) continue

        for (const target of targetSymbols) {
          // Only create edges to symbols in DIFFERENT files
          if (target.filePath === filePath) continue

          addEdge({
            id: makeEdgeId('call'),
            source: caller.id,
            target: target.id,
            kind: 'call',
          })
        }
      }
    }
  }

  return edges
}
