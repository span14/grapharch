import { spawn } from 'node:child_process'

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

export interface ClaudeCall {
  promise: Promise<string>
  abort: () => void
}

/**
 * Call Claude via the `claude` CLI in non-interactive mode.
 * Pipes the prompt via stdin to handle large prompts.
 * Uses the user's existing Claude Code subscription — no API key needed.
 *
 * Returns a ClaudeCall with a promise and an abort() handle so callers
 * can cancel the in-flight child process.
 */
export function callClaude(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): ClaudeCall {
  const selectedModel = model ?? DEFAULT_MODEL

  const args = [
    '-p', '-',  // read prompt from stdin
    '--model', selectedModel,
    '--output-format', 'json',
    '--append-system-prompt', systemPrompt,
    '--no-session-persistence',
  ]

  let proc: ReturnType<typeof spawn> | null = null

  const promise = new Promise<string>((resolve, reject) => {
    proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000, // 5 minutes per call
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10MB
    const MAX_STDERR_BYTES = 1 * 1024 * 1024 // 1MB — cap stderr too (N1 fix)

    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn() }  // R2 fix: prevent double-settle
    }

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > MAX_RESPONSE_BYTES) {
        proc?.kill()
        settle(() => reject(new Error('Claude CLI response exceeded 10MB limit')))
      }
    })
    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) {
        stderr += data.toString()
      }
    })

    proc.on('error', (err) => {
      settle(() => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)))
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        settle(() => reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`)))
        return
      }

      try {
        const result = JSON.parse(stdout)
        if (result.is_error) {
          settle(() => reject(new Error(`claude CLI error: ${result.result}`)))
          return
        }
        settle(() => resolve(result.result))
      } catch {
        settle(() => resolve(stdout.trim()))
      }
    })

    // Write prompt to stdin and close
    proc.stdin.write(userPrompt)
    proc.stdin.end()
  })

  return {
    promise,
    abort: () => { proc?.kill() },
  }
}

/**
 * Parse a JSON response from Claude, handling markdown code fences.
 */
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim()
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  }
  return JSON.parse(cleaned)
}
