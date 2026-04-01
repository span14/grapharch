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
