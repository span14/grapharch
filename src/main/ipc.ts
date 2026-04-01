import { ipcMain, dialog, utilityProcess, BrowserWindow } from 'electron'
import path from 'node:path'

let worker: Electron.UtilityProcess | null = null

export function setupIPC(mainWindow: BrowserWindow): void {
  // Spawn the worker utility process.
  // The Forge Vite plugin builds all `build` entries into `.vite/build/`.
  // The worker entry `src/worker/index.ts` is compiled to `worker.js`
  // in the same directory as the main process bundle.
  const workerPath = path.join(__dirname, 'worker.js')

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

  // Forward worker messages to renderer
  worker.on('message', (msg: { type: string; data?: unknown }) => {
    console.log('[worker:msg]', msg.type)
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(msg.type, msg.data)
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
}

export function shutdownWorker(): void {
  worker?.kill()
  worker = null
}
