import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import type { LoginStatus } from '../shared/contracts';
import {
  favoriteDirectionSchema,
  favoriteIdSchema,
  favoriteInputSchema,
  previewInputSchema,
  queryFiltersSchema,
} from './validation';
import { BookingPreviewService } from './services/booking-preview';
import { BookingQueryService } from './services/booking-query';
import { BookingSessionService } from './services/booking-session';
import { FavoritesStore } from './services/favorites-store';

interface IpcDependencies {
  getMainWindow(): BrowserWindow | null;
  sessionService: BookingSessionService;
  queryService: BookingQueryService;
  previewService: BookingPreviewService;
  favoritesStore: FavoritesStore;
}

export function registerIpcHandlers(dependencies: IpcDependencies): void {
  const {
    getMainWindow,
    sessionService,
    queryService,
    previewService,
    favoritesStore,
  } = dependencies;
  const assertCurrentSender = (event: IpcMainInvokeEvent) => {
    assertTrustedSender(event, getMainWindow);
  };

  ipcMain.handle('auth:get-status', (event) => {
    assertCurrentSender(event);
    return sessionService.getStatus();
  });
  ipcMain.handle('auth:open-login', async (event) => {
    assertCurrentSender(event);
    return sessionService.openLoginWindow();
  });
  ipcMain.handle('booking:query', async (event, rawFilters: unknown) => {
    assertCurrentSender(event);
    const filters = queryFiltersSchema.parse(rawFilters);
    return queryService.query(filters);
  });
  ipcMain.handle('booking:create-preview', (event, rawInput: unknown) => {
    assertCurrentSender(event);
    const previewInput = previewInputSchema.parse(rawInput);
    return previewService.create(previewInput);
  });
  ipcMain.handle('favorites:list', (event) => {
    assertCurrentSender(event);
    return favoritesStore.list();
  });
  ipcMain.handle('favorites:save', (event, rawInput: unknown) => {
    assertCurrentSender(event);
    return favoritesStore.save(favoriteInputSchema.parse(rawInput));
  });
  ipcMain.handle('favorites:remove', (event, rawFavoriteId: unknown) => {
    assertCurrentSender(event);
    return favoritesStore.remove(favoriteIdSchema.parse(rawFavoriteId));
  });
  ipcMain.handle('favorites:move', (event, rawFavoriteId: unknown, rawDirection: unknown) => {
    assertCurrentSender(event);
    return favoritesStore.move(
      favoriteIdSchema.parse(rawFavoriteId),
      favoriteDirectionSchema.parse(rawDirection),
    );
  });

  sessionService.on('status-changed', (status: LoginStatus) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auth:status-changed', status);
    }
  });
}

export function removeIpcHandlers(): void {
  [
    'auth:get-status',
    'auth:open-login',
    'booking:query',
    'booking:create-preview',
    'favorites:list',
    'favorites:save',
    'favorites:remove',
    'favorites:move',
  ].forEach((channel) => ipcMain.removeHandler(channel));
}

function assertTrustedSender(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null,
): void {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    throw new Error('拒绝来自非主窗口的桌面 API 请求。');
  }
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('拒绝来自子框架的桌面 API 请求。');
  }

  const senderUrl = event.senderFrame?.url || '';
  let parsedSenderUrl: URL;
  try {
    parsedSenderUrl = new URL(senderUrl);
  } catch {
    throw new Error('拒绝 URL 无效的桌面 API 请求。');
  }
  const isDevelopmentRenderer = parsedSenderUrl.protocol === 'http:'
    && parsedSenderUrl.hostname === 'localhost';
  const isPackagedRenderer = parsedSenderUrl.protocol === 'file:';
  if (!isDevelopmentRenderer && !isPackagedRenderer) {
    throw new Error('拒绝来自未知页面的桌面 API 请求。');
  }
}
