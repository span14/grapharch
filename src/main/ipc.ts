import { ipcMain, dialog, utilityProcess, BrowserWindow } from 'electron'
import path from 'node:path'

let worker: Electron.UtilityProcess | null = null

export function setupIPC(mainWindow: BrowserWindow): void {
  // Remove any previously registered handlers to avoid duplicate handler errors
  // when setupIPC is called again (e.g., on macOS activate)
  for (const channel of ['project:open', 'project:refresh', 'dialog:open-folder', 'analysis:start', 'analysis:cancel', 'component:chat', 'component:edit']) {
    ipcMain.removeHandler(channel)
  }

  // Spawn the worker utility process.
  // The Forge Vite plugin builds all `build` entries into `.vite/build/`.
  // The worker entry `src/worker/index.ts` is compiled to `worker.js`
  // in the same directory as the main process bundle.
  const workerPath = path.join(__dirname, 'worker.js')

  // Kill existing worker before spawning a new one (macOS activate re-entry)
  if (worker) {
    worker.kill()
    worker = null
  }

  worker = utilityProcess.fork(workerPath, [], {
    serviceName: 'grapharc-parser',
    stdio: 'pipe',
  })

  // Log worker stdout/stderr for debugging
  worker.stdout?.on('data', (data: Buffer) => {
    console.log('[worker:stdout]', data.toString().trim())
  })
  worker.stderr?.on('data', (data: Buffer) => {
    console.error('[worker:stderr]', data.toString().trim())
  })

  // Allowlist of valid worker message types to forward to renderer
  const validMessageTypes = new Set([
    'worker:ready',
    'graph:ready',
    'graph:diff',
    'parse:progress',
    'parse:error',
    'analysis:progress',
    'analysis:node',
    'analysis:edge',
    'analysis:project',
    'analysis:error',
    'analysis:complete',
    'analysis:cache-loading',
    'component:chat-response',
    'component:chat-error',
  ])

  // Forward worker messages to renderer
  worker.on('message', (msg: { type: string; data?: unknown }) => {
    console.log('[worker:msg]', msg.type)
    if (!validMessageTypes.has(msg.type)) {
      console.warn('[worker:msg] Ignoring unknown message type:', msg.type)
      return
    }
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(msg.type, msg.data)
    }
  })

  // Detect worker crash
  worker.on('exit', (code) => {
    console.error(`[worker] exited with code ${code}`)
    if (code !== 0 && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('parse:error', {
        file: 'worker',
        error: `Worker process crashed (code ${code}). Please restart the app.`,
      })
    }
  })

  // Handle renderer requests
  ipcMain.handle('project:open', (_event, rootDir: string) => {
    worker?.postMessage({ type: 'project:open', data: { rootDir } })
  })

  ipcMain.handle('project:refresh', () => {
    worker?.postMessage({ type: 'project:refresh' })
  })

  ipcMain.handle('dialog:open-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const rootDir = result.filePaths[0]
    worker?.postMessage({ type: 'project:open', data: { rootDir } })
    return rootDir
  })

  ipcMain.handle('analysis:start', (_event, model?: string) => {
    worker?.postMessage({ type: 'analysis:start', data: { model } })
  })

  ipcMain.handle('analysis:cancel', () => {
    worker?.postMessage({ type: 'analysis:cancel' })
  })

  ipcMain.handle('component:chat', (_event, request: unknown) => {
    worker?.postMessage({ type: 'component:chat', data: request })
  })

  ipcMain.handle('component:edit', (_event, request: unknown) => {
    worker?.postMessage({ type: 'component:edit', data: request })
  })
}

export function getWorker(): Electron.UtilityProcess | null {
  return worker
}

export function shutdownWorker(): void {
  worker?.kill()
  worker = null
}
