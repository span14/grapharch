export const IPC = {
  // Renderer -> Main
  PROJECT_OPEN: 'project:open',
  PROJECT_REFRESH: 'project:refresh',
  DIALOG_OPEN_FOLDER: 'dialog:open-folder',
  ANALYSIS_START: 'analysis:start',
  ANALYSIS_CANCEL: 'analysis:cancel',

  // Main -> Renderer (forwarded from worker)
  GRAPH_READY: 'graph:ready',
  GRAPH_DIFF: 'graph:diff',
  PARSE_PROGRESS: 'parse:progress',
  PARSE_ERROR: 'parse:error',
  ANALYSIS_PROGRESS: 'analysis:progress',
  ANALYSIS_NODE: 'analysis:node',
  ANALYSIS_EDGE: 'analysis:edge',
  ANALYSIS_PROJECT: 'analysis:project',
  ANALYSIS_ERROR: 'analysis:error',
} as const
