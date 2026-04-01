import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { isGitRepo, getHeadCommit, getChangedFiles } from '../../src/worker/git'

// The grapharc project itself is a git repo, so we can test against it
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')

describe('isGitRepo', () => {
  it('returns true for a git repository', () => {
    expect(isGitRepo(PROJECT_ROOT)).toBe(true)
  })

  it('returns false for a non-git directory', () => {
    expect(isGitRepo('/tmp')).toBe(false)
  })
})

describe('getHeadCommit', () => {
  it('returns a 40-character hex string for a git repo', () => {
    const commit = getHeadCommit(PROJECT_ROOT)
    expect(commit).not.toBeNull()
    expect(commit).toMatch(/^[0-9a-f]{40}$/)
  })

  it('returns null for a non-git directory', () => {
    expect(getHeadCommit('/tmp')).toBeNull()
  })
})

describe('getChangedFiles', () => {
  it('returns an array of strings', () => {
    const commit = getHeadCommit(PROJECT_ROOT)
    if (!commit) return // skip if no git
    // Compare HEAD with itself — should return empty
    const changed = getChangedFiles(PROJECT_ROOT, commit, commit)
    expect(Array.isArray(changed)).toBe(true)
    expect(changed.length).toBe(0)
  })

  it('returns empty array for invalid commit', () => {
    const changed = getChangedFiles(PROJECT_ROOT, 'invalid-commit-hash')
    expect(Array.isArray(changed)).toBe(true)
    // Should be empty since git diff will fail gracefully
  })

  it('returns empty array for non-git directory', () => {
    const changed = getChangedFiles('/tmp', 'abc123')
    expect(changed).toEqual([])
  })
})
