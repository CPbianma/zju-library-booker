import { join } from 'node:path';

import { app, BrowserWindow, shell } from 'electron';

import { registerIpcHandlers, removeIpcHandlers } from './ipc-handlers';
import { BookingApiService } from './services/booking-api';
import { BookingPreviewService } from './services/booking-preview';
import { BookingQueryService } from './services/booking-query';
import { BookingSessionService } from './services/booking-session';
import { FavoritesStore } from './services/favorites-store';

let mainWindow: BrowserWindow | null = null;
const sessionService = new BookingSessionService();

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    title: 'ZJU Library Booker',
    backgroundColor: '#f3f7fb',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (process.platform !== 'darwin') app.quit();
  });
  window.once('ready-to-show', () => window.show());

  return window;
}

async function loadMainWindow(window: BrowserWindow): Promise<void> {
  const developmentServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (developmentServerUrl) {
    await window.loadURL(developmentServerUrl);
  } else {
    await window.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(async () => {
  app.setAppUserModelId('cn.edu.zju.library-booker');
  mainWindow = createMainWindow();

  const apiService = new BookingApiService(sessionService);
  registerIpcHandlers({
    getMainWindow: () => mainWindow,
    sessionService,
    queryService: new BookingQueryService(apiService),
    previewService: new BookingPreviewService(),
    favoritesStore: new FavoritesStore(),
  });
  await loadMainWindow(mainWindow);
  await sessionService.initialize();

  app.on('activate', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createMainWindow();
      await loadMainWindow(mainWindow);
    }
  });
}).catch((error: unknown) => {
  console.error(error);
  app.quit();
});

app.on('before-quit', () => {
  sessionService.markApplicationQuitting();
  removeIpcHandlers();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
