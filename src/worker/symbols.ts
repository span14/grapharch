import type { Node as TSNode } from 'web-tree-sitter'
import type { GraphNode } from '../shared/types'
import { initParser, parse } from './parser'

export { initParser }

/**
 * Check whether a tree-sitter node (or any of its anonymous children)
 * contains the `async` keyword, indicating an async function.
 */
function isAsync(node: TSNode): boolean {
  for (const child of node.children) {
    if (!child.isNamed && child.type === 'async') return true
  }
  return false
}

/**
 * Collect decorator names from a `decorated_definition` node.
 */
function extractDecorators(decoratedNode: TSNode): string[] {
  const decorators: string[] = []
  for (const child of decoratedNode.children) {
    if (child.type === 'decorator') {
      // The decorator text looks like "@foo" or "@foo.bar(...)".
      // We take the raw text minus the leading "@".
      const text = child.text.replace(/^@/, '').trim()
      decorators.push(text)
    }
  }
  return decorators
}

/**
 * Build a GraphNode id.
 * Module:   "filepath"
 * Function: "filepath::funcname"
 * Class:    "filepath::ClassName"
 * Method:   "filepath::ClassName.methodname"
 */
function makeId(filePath: string, name: string, className?: string): string {
  if (className) return `${filePath}::${className}.${name}`
  return `${filePath}::${name}`
}

/**
 * Extract methods from a class body block.
 */
function extractMethods(
  blockNode: TSNode,
  filePath: string,
  className: string,
  classId: string
): GraphNode[] {
  const methods: GraphNode[] = []

  for (const child of blockNode.children) {
    let funcNode: TSNode | null = null
    let decorators: string[] = []

    if (child.type === 'function_definition') {
      funcNode = child
    } else if (child.type === 'decorated_definition') {
      decorators = extractDecorators(child)
      for (const inner of child.children) {
        if (inner.type === 'function_definition') {
          funcNode = inner
          break
        }
      }
    }

    if (!funcNode) continue

    const nameNode = funcNode.childForFieldName('name')
    if (!nameNode) continue

    const name = nameNode.text
    methods.push({
      id: makeId(filePath, name, className),
      kind: 'method',
      label: name,
      filePath,
      lineRange: [
        funcNode.startPosition.row + 1,
        funcNode.endPosition.row + 1,
      ],
      parent: classId,
      metadata: {
        async: isAsync(funcNode),
        ...(decorators.length > 0 ? { decorators } : {}),
      },
    })
  }

  return methods
}

/**
 * Process a top-level `function_definition` node.
 */
function processFunctionDef(
  node: TSNode,
  filePath: string,
  decorators: string[]
): GraphNode | null {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return null

  const name = nameNode.text
  return {
    id: makeId(filePath, name),
    kind: 'function',
    label: name,
    filePath,
    lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
    parent: filePath,
    metadata: {
      async: isAsync(node),
      ...(decorators.length > 0 ? { decorators } : {}),
    },
  }
}

/**
 * Process a top-level `class_definition` node.
 * Returns the class node followed by its method nodes.
 */
function processClassDef(
  node: TSNode,
  filePath: string,
  decorators: string[]
): GraphNode[] {
  const nameNode = node.childForFieldName('name')
  if (!nameNode) return []

  const name = nameNode.text
  const classId = makeId(filePath, name)

  const bodyNode = node.childForFieldName('body')
  const methods = bodyNode
    ? extractMethods(bodyNode, filePath, name, classId)
    : []

  const classNode: GraphNode = {
    id: classId,
    kind: 'class',
    label: name,
    filePath,
    lineRange: [node.startPosition.row + 1, node.endPosition.row + 1],
    parent: filePath,
    childCount: methods.length,
    metadata: {
      ...(decorators.length > 0 ? { decorators } : {}),
    },
  }

  return [classNode, ...methods]
}

/**
 * Parse Python source and extract all symbols as GraphNode[].
 *
 * The returned array contains:
 *  - One `module` node for the file
 *  - One `function` node per top-level function
 *  - One `class` node per class
 *  - One `method` node per method inside each class
 */
export function extractSymbols(source: string, filePath: string): GraphNode[] {
  const tree = parse(source)
  const root = tree.rootNode
  const nodes: GraphNode[] = []

  let topLevelDefCount = 0

  for (const child of root.children) {
    let defNode: TSNode | null = null
    let decorators: string[] = []

    if (
      child.type === 'function_definition' ||
      child.type === 'class_definition'
    ) {
      defNode = child
    } else if (child.type === 'decorated_definition') {
      decorators = extractDecorators(child)
      for (const inner of child.children) {
        if (
          inner.type === 'function_definition' ||
          inner.type === 'class_definition'
        ) {
          defNode = inner
          break
        }
      }
    }

    if (!defNode) continue

    topLevelDefCount++

    if (defNode.type === 'function_definition') {
      const funcNode = processFunctionDef(defNode, filePath, decorators)
      if (funcNode) nodes.push(funcNode)
    } else if (defNode.type === 'class_definition') {
      nodes.push(...processClassDef(defNode, filePath, decorators))
    }
  }

  // Create the module node
  const moduleNode: GraphNode = {
    id: filePath,
    kind: 'module',
    label: filePath,
    filePath,
    lineRange: [1, root.endPosition.row + 1],
    childCount: topLevelDefCount,
    metadata: {},
  }

  return [moduleNode, ...nodes]
}
