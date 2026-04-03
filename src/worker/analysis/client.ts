import { spawn } from 'node:child_process'

const DEFAULT_MODEL = 'claude-sonnet-4-20250514'
const MAX_RETRIES = 2

export interface ClaudeCall {
  promise: Promise<string>
  abort: () => void
}

/**
 * Spawn a single claude CLI call and collect stdout.
 */
function spawnClaude(
  args: string[],
  input: string,
): { promise: Promise<{ stdout: string; code: number }>; kill: () => void } {
  let proc: ReturnType<typeof spawn> | null = null

  const promise = new Promise<{ stdout: string; code: number }>((resolve, reject) => {
    proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 300_000,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const MAX_RESPONSE_BYTES = 10 * 1024 * 1024
    const MAX_STDERR_BYTES = 1 * 1024 * 1024

    const settle = (fn: () => void) => {
      if (!settled) { settled = true; fn() }
    }

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
      if (stdout.length > MAX_RESPONSE_BYTES) {
        proc?.kill()
        settle(() => reject(new Error('Claude CLI response exceeded 10MB limit')))
      }
    })
    proc.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += data.toString()
    })
    proc.on('error', (err) => {
      settle(() => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)))
    })
    proc.on('close', (code) => {
      if (code !== 0) {
        settle(() => reject(new Error(`claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`)))
        return
      }
      settle(() => resolve({ stdout, code: code ?? 0 }))
    })

    proc.stdin.write(input)
    proc.stdin.end()
  })

  return { promise, kill: () => proc?.kill() }
}

/**
 * Extract the text result from Claude CLI JSON output.
 */
function extractResult(stdout: string): string {
  try {
    const result = JSON.parse(stdout)
    if (result.is_error) throw new Error(`claude CLI error: ${result.result}`)
    if (typeof result.result === 'string') return result.result
    // If result is an object (not string), stringify it — might already be our JSON
    if (result.result && typeof result.result === 'object') return JSON.stringify(result.result)
    // Fallback: try the whole object
    return stdout.trim()
  } catch {
    return stdout.trim()
  }
}

/**
 * Call Claude via the `claude` CLI. On JSON parse failure, retries by
 * resuming the session and sending the error as feedback so Claude can fix it.
 */
export function callClaude(
  systemPrompt: string,
  userPrompt: string,
  model?: string
): ClaudeCall {
  const selectedModel = model ?? DEFAULT_MODEL
  let currentSpawn: { kill: () => void } | null = null
  let aborted = false

  const promise = (async () => {
    // First attempt
    const firstArgs = [
      '-p', '-',
      '--model', selectedModel,
      '--output-format', 'json',
      '--append-system-prompt', systemPrompt,
      '--no-session-persistence',
    ]

    const first = spawnClaude(firstArgs, userPrompt)
    currentSpawn = first
    const { stdout } = await first.promise
    currentSpawn = null

    const text = extractResult(stdout)

    // Try parsing JSON
    try {
      parseJsonResponse(text)
      return text  // valid JSON — return
    } catch (parseErr) {
      // JSON parse failed — retry with feedback
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr)

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (aborted) throw new Error('Aborted')

        const prevResponse = text.slice(0, 500)
        const feedback = `Your previous response could not be parsed as JSON.\nError: ${errMsg}\nYour response started with: ${prevResponse}\n\nPlease try again. Output ONLY the valid JSON object as specified in the required output format. No markdown fences, no commentary, no explanation — just the raw JSON object starting with { and ending with }.`

        const retryArgs = [
          '-p', '-',
          '--model', selectedModel,
          '--output-format', 'json',
          '--append-system-prompt', systemPrompt,
          '--no-session-persistence',
        ]

        const retry = spawnClaude(retryArgs, `${userPrompt}\n\n---\nPREVIOUS ATTEMPT FAILED\n${feedback}`)
        currentSpawn = retry
        const retryResult = await retry.promise
        currentSpawn = null

        const retryText = extractResult(retryResult.stdout)
        try {
          parseJsonResponse(retryText)
          return retryText  // valid JSON on retry
        } catch (retryParseErr) {
          if (attempt === MAX_RETRIES) {
            throw new Error(`Failed to get valid JSON after ${MAX_RETRIES + 1} attempts. Last error: ${retryParseErr instanceof Error ? retryParseErr.message : String(retryParseErr)}`)
          }
        }
      }

      return text  // shouldn't reach here
    }
  })()

  return {
    promise,
    abort: () => { aborted = true; currentSpawn?.kill() },
  }
}

/**
 * Parse a JSON response from Claude, handling markdown code fences
 * and any surrounding text.
 */
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim()

  // Strip markdown fences (possibly multiple)
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?\s*```$/gm, '').trim()

  // Try direct parse first
  try {
    return JSON.parse(cleaned)
  } catch { /* fall through */ }

  // Find the outermost balanced JSON object
  const start = cleaned.indexOf('{')
  if (start !== -1) {
    let depth = 0
    let inString = false
    let escape = false
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i]
      if (escape) { escape = false; continue }
      if (ch === '\\' && inString) { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      if (ch === '}') {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(cleaned.slice(start, i + 1))
          } catch { /* keep scanning */ }
        }
      }
    }
  }

  throw new Error(`Failed to parse JSON from Claude response (${cleaned.length} chars): ${cleaned.slice(0, 300)}...`)
}
