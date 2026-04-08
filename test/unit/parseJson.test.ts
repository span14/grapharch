import { describe, it, expect } from 'vitest'
import { parseJsonResponse } from '../../src/worker/analysis/client'

describe('parseJsonResponse', () => {
  it('parses clean JSON', () => {
    const result = parseJsonResponse<{ a: number }>('{"a":1}')
    expect(result).toEqual({ a: 1 })
  })

  it('parses markdown-fenced JSON', () => {
    const input = '```json\n{"a":1}\n```'
    const result = parseJsonResponse<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('extracts JSON with text before/after', () => {
    const input = 'Here is the result:\n{"a":1}\nDone.'
    const result = parseJsonResponse<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('handles nested braces in strings', () => {
    const input = '{"msg":"hello {world}"}'
    const result = parseJsonResponse<{ msg: string }>(input)
    expect(result).toEqual({ msg: 'hello {world}' })
  })

  it('throws on truncated JSON', () => {
    expect(() => parseJsonResponse('{"a":1')).toThrow()
  })

  it('throws with descriptive error on no JSON at all', () => {
    expect(() => parseJsonResponse('Based on my analysis...')).toThrow(/Failed to parse JSON/)
  })

  it('returns first complete JSON object when multiple are present', () => {
    const input = '{"a":1} {"b":2}'
    const result = parseJsonResponse<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })
})
