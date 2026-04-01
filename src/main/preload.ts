import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('grapharc', {
  openProject: (rootDir: string) => ipcRenderer.invoke('project:open', rootDir),
  refreshProject: () => ipcRenderer.invoke('project:refresh'),
  openFolderDialog: () => ipcRenderer.invoke('dialog:open-folder'),
  onGraphReady: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('graph:ready', handler)
    return () => { ipcRenderer.removeListener('graph:ready', handler) }
  },
  onGraphDiff: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('graph:diff', handler)
    return () => { ipcRenderer.removeListener('graph:diff', handler) }
  },
  onParseProgress: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('parse:progress', handler)
    return () => { ipcRenderer.removeListener('parse:progress', handler) }
  },
  onParseError: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('parse:error', handler)
    return () => { ipcRenderer.removeListener('parse:error', handler) }
  },
})
