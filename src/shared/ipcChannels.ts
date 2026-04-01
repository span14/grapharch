export const IPC = {
  // Renderer -> Main
  PROJECT_OPEN: 'project:open',
  PROJECT_REFRESH: 'project:refresh',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',

  // Main -> Renderer (forwarded from worker)
  GRAPH_READY: 'graph:ready',
  GRAPH_DIFF: 'graph:diff',
  PARSE_PROGRESS: 'parse:progress',
  PARSE_ERROR: 'parse:error',
} as const
