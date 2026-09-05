import { contextBridge, ipcRenderer } from 'electron';

import type {
  DesktopApi,
  FavoriteInput,
  LoginStatus,
  PreviewInput,
  QueryFilters,
} from '../shared/contracts';

const desktopApi: DesktopApi = {
  getLoginStatus: () => ipcRenderer.invoke('auth:get-status'),
  openLoginWindow: () => ipcRenderer.invoke('auth:open-login'),
  onLoginStatusChanged: (listener) => {
    const eventListener = (_event: Electron.IpcRendererEvent, status: LoginStatus) => listener(status);
    ipcRenderer.on('auth:status-changed', eventListener);
    return () => ipcRenderer.removeListener('auth:status-changed', eventListener);
  },
  queryAvailability: (filters: QueryFilters) => ipcRenderer.invoke('booking:query', filters),
  createPreview: (input: PreviewInput) => ipcRenderer.invoke('booking:create-preview', input),
  listFavorites: () => ipcRenderer.invoke('favorites:list'),
  saveFavorite: (input: FavoriteInput) => ipcRenderer.invoke('favorites:save', input),
  removeFavorite: (favoriteId: string) => ipcRenderer.invoke('favorites:remove', favoriteId),
  moveFavorite: (favoriteId: string, direction: 'up' | 'down') => (
    ipcRenderer.invoke('favorites:move', favoriteId, direction)
  ),
};

contextBridge.exposeInMainWorld('bookingDesktop', desktopApi);
