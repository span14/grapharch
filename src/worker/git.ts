import { execFileSync } from 'node:child_process'

/**
 * Check if a directory is inside a git repository.
 */
export function isGitRepo(dir: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

/**
 * Get the current HEAD commit hash.
 * Returns null if not a git repo or HEAD doesn't exist.
 */
export function getHeadCommit(dir: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return null
  }
}

/**
 * Get list of .py files changed between two commits.
 * If toCommit is omitted, compares against HEAD.
 * Returns relative paths.
 */
export function getChangedFiles(
  dir: string,
  fromCommit: string,
  toCommit = 'HEAD'
): string[] {
  try {
    const output = execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=ACMR', fromCommit, toCommit, '--', '*.py'],
      { cwd: dir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()
    if (!output) return []
    return output.split('\n').filter(Boolean)
  } catch {
    return []
  }
}
