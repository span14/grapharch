import { Menu, BrowserWindow, dialog } from 'electron'

/**
 * Create the native application menu.
 *
 * The menu includes:
 * - File > Open Project Folder... (triggers the folder dialog via IPC)
 * - View > Reload / Toggle DevTools
 *
 * @param worker - The worker utility process, needed to forward open-folder events
 */
export function createMenu(mainWindow: BrowserWindow, worker?: Electron.UtilityProcess | null): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Project Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Open Project Folder',
            })
            if (!result.canceled && result.filePaths.length > 0) {
              worker?.postMessage({ type: 'project:open', data: { rootDir: result.filePaths[0] } })
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]

  // On macOS, add the application menu (first item)
  if (process.platform === 'darwin') {
    template.unshift({
      label: 'GraphArc',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
