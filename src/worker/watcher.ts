import { watch, type FSWatcher } from 'chokidar'

let watcher: FSWatcher | null = null

export function startWatching(
  rootDir: string,
  onChange: (filePath: string) => void,
  onRemove: (filePath: string) => void
): void {
  stopWatching()

  watcher = watch(rootDir, {
    ignored: /(^|[/\\])(\.|__pycache__|\.venv|node_modules|\.git)/,
    persistent: true,
    ignoreInitial: true,
  })

  watcher.on('change', (path) => {
    if (path.endsWith('.py')) onChange(path)
  })
  watcher.on('add', (path) => {
    if (path.endsWith('.py')) onChange(path)
  })
  watcher.on('unlink', (path) => {
    if (path.endsWith('.py')) onRemove(path)
  })
}

export function stopWatching(): void {
  if (watcher) {
    watcher.close()
    watcher = null
  }
}
