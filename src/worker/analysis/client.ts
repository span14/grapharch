import { spawn } from 'node:child_process'

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'

/**
 * Call Claude via the `claude` CLI in non-interactive mode.
 * Pipes the prompt via stdin to handle large prompts.
 * Uses the user's existing Claude Code subscription — no API key needed.
 */
export function callClaude(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): Promise<string> {
  const selectedModel = model ?? DEFAULT_MODEL

  const args = [
    '-p', '-',  // read prompt from stdin
    '--model', selectedModel,
    '--output-format', 'json',
    '--append-system-prompt', systemPrompt,
    '--no-session-persistence',
  ]

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000, // 5 minutes per call
    })

    let stdout = ''
    let stderr = ''
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024 // 10MB

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > MAX_RESPONSE_BYTES) {
        proc.kill()
        reject(new Error('Claude CLI response exceeded 10MB limit'))
      }
    })
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`))
    })

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`))
        return
      }

      try {
        const result = JSON.parse(stdout)
        if (result.is_error) {
          reject(new Error(`claude CLI error: ${result.result}`))
          return
        }
        resolve(result.result)
      } catch {
        resolve(stdout.trim())
      }
    })

    // Write prompt to stdin and close
    proc.stdin.write(userPrompt)
    proc.stdin.end()
  })
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
