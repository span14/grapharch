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
