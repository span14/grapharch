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

  // Analysis
  startAnalysis: (model?: string) => ipcRenderer.invoke('analysis:start', model),
  cancelAnalysis: () => ipcRenderer.invoke('analysis:cancel'),
  onAnalysisProgress: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:progress', handler)
    return () => { ipcRenderer.removeListener('analysis:progress', handler) }
  },
  onAnalysisNode: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:node', handler)
    return () => { ipcRenderer.removeListener('analysis:node', handler) }
  },
  onAnalysisEdge: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:edge', handler)
    return () => { ipcRenderer.removeListener('analysis:edge', handler) }
  },
  onAnalysisProject: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:project', handler)
    return () => { ipcRenderer.removeListener('analysis:project', handler) }
  },
  onAnalysisError: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:error', handler)
    return () => { ipcRenderer.removeListener('analysis:error', handler) }
  },
  onAnalysisComplete: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('analysis:complete', handler)
    return () => { ipcRenderer.removeListener('analysis:complete', handler) }
  },
  onAnalysisCacheLoading: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('analysis:cache-loading', handler)
    return () => { ipcRenderer.removeListener('analysis:cache-loading', handler) }
  },

  // Component chat & edit
  sendComponentChat: (request: unknown) => ipcRenderer.invoke('component:chat', request),
  editComponent: (request: unknown) => ipcRenderer.invoke('component:edit', request),
  onComponentChatResponse: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('component:chat-response', handler)
    return () => { ipcRenderer.removeListener('component:chat-response', handler) }
  },
  onComponentChatError: (cb: (data: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown) => cb(data)
    ipcRenderer.on('component:chat-error', handler)
    return () => { ipcRenderer.removeListener('component:chat-error', handler) }
  },
})
