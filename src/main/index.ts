import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { setupIPC, shutdownWorker, getWorker } from './ipc';
import { createMenu } from './menu';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection in main:', reason)
})

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = () => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // DevTools: only open via keyboard shortcut (Cmd+Alt+I) or menu

  // Wire up IPC handlers and spawn the worker process
  setupIPC(mainWindow);

  // Set up the native application menu
  createMenu(mainWindow, getWorker());
};

app.on('ready', createWindow);

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    // Allow dev server and local file loads, block external navigation
    if (!url.startsWith('http://localhost') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' as const }))
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  shutdownWorker();
});
