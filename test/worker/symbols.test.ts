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
  it('extracts top-level functions', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const funcs = symbols.filter((s) => s.kind === 'function')
    expect(funcs).toHaveLength(2)
    expect(funcs.map(f => f.label).sort()).toEqual(['async_func', 'top_level_func'])
  })

  it('detects async functions', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const asyncFunc = symbols.find((s) => s.label === 'async_func')
    expect(asyncFunc).toBeDefined()
    expect(asyncFunc!.metadata.async).toBe(true)
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
    expect(methods.map(m => m.label).sort()).toEqual(['__init__', 'my_method'])
    // Methods should have parent pointing to class
    expect(methods[0].parent).toContain('MyClass')
  })

  it('creates a module node', () => {
    const symbols = extractSymbols(SAMPLE_CODE, 'test.py')
    const module = symbols.find((s) => s.kind === 'module')
    expect(module).toBeDefined()
    expect(module!.label).toBe('test.py')
  })
})
