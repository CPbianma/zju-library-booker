import { EventEmitter } from 'node:events';

import { BrowserWindow, type WebContents } from 'electron';

import type { LoginStatus } from '../../shared/contracts';

const BOOKING_ORIGIN = 'https://booking.lib.zju.edu.cn';
const BOOKING_PAGE_URL = `${BOOKING_ORIGIN}/h5/index.html#/login`;
const SESSION_PARTITION = 'persist:zju-library-booking';
const TRUSTED_AUTHENTICATION_HOSTS = new Set([
  'booking.lib.zju.edu.cn',
  'zjuam.zju.edu.cn',
]);

export class BookingSessionService extends EventEmitter {
  private sessionWindow: BrowserWindow | null = null;
  private status: LoginStatus = {
    state: 'checking',
    message: '正在检查登录会话',
  };
  private statusMonitor: NodeJS.Timeout | null = null;
  private applicationIsQuitting = false;

  public async initialize(): Promise<void> {
    const sessionWindow = this.ensureSessionWindow();
    this.startStatusMonitor();

    try {
      await sessionWindow.loadURL(BOOKING_PAGE_URL);
      await this.refreshStatus();
    } catch {
      this.updateStatus({
        state: 'error',
        message: '无法打开图书馆预约系统，请检查网络连接',
      });
    }
  }

  public getStatus(): LoginStatus {
    return { ...this.status };
  }

  public async openLoginWindow(): Promise<LoginStatus> {
    const sessionWindow = this.ensureSessionWindow();
    const currentUrl = sessionWindow.webContents.getURL();

    if (!currentUrl || !isTrustedAuthenticationUrl(currentUrl) || this.status.state === 'error') {
      this.updateStatus({ state: 'authenticating', message: '正在重新加载认证页面' });
      await sessionWindow.loadURL(BOOKING_PAGE_URL);
    }

    this.updateStatus({
      state: this.status.state === 'authenticated' ? 'authenticated' : 'authenticating',
      message: this.status.state === 'authenticated' ? '登录会话有效' : '请在认证窗口中完成登录',
    });
    sessionWindow.show();
    sessionWindow.focus();
    await this.refreshStatus();
    return this.getStatus();
  }

  public async getAuthenticatedWebContents(): Promise<WebContents> {
    const sessionWindow = this.ensureSessionWindow();
    await this.refreshStatus();

    if (this.status.state !== 'authenticated') {
      throw new Error('尚未登录，请先点击右上角的“登录”并完成统一身份认证。');
    }

    return sessionWindow.webContents;
  }

  public markApplicationQuitting(): void {
    this.applicationIsQuitting = true;
    if (this.statusMonitor) {
      clearInterval(this.statusMonitor);
      this.statusMonitor = null;
    }
  }

  public markUnauthenticated(message = '登录会话已失效，请重新登录'): void {
    this.updateStatus({ state: 'unauthenticated', message });
  }

  private ensureSessionWindow(): BrowserWindow {
    if (
      this.sessionWindow
      && !this.sessionWindow.isDestroyed()
      && !this.sessionWindow.webContents.isCrashed()
    ) return this.sessionWindow;
    if (this.sessionWindow && !this.sessionWindow.isDestroyed()) this.sessionWindow.destroy();

    this.sessionWindow = new BrowserWindow({
      width: 1080,
      height: 780,
      minWidth: 860,
      minHeight: 620,
      show: false,
      title: 'ZJU Library Booker - 登录',
      autoHideMenuBar: true,
      webPreferences: {
        partition: SESSION_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const sessionWindow = this.sessionWindow;
    const authenticationSession = sessionWindow.webContents.session;
    authenticationSession.setPermissionCheckHandler(() => false);
    authenticationSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
    authenticationSession.on('will-download', (event) => event.preventDefault());

    sessionWindow.on('close', (event) => {
      if (!this.applicationIsQuitting) {
        event.preventDefault();
        sessionWindow.hide();
      }
    });

    const blockUntrustedNavigation = (event: Electron.Event, url: string) => {
      if (isTrustedAuthenticationUrl(url)) return;
      event.preventDefault();
      this.updateStatus({ state: 'error', message: '已阻止登录窗口跳转到未知站点' });
    };
    sessionWindow.webContents.on('will-navigate', blockUntrustedNavigation);
    sessionWindow.webContents.on('will-redirect', blockUntrustedNavigation);
    sessionWindow.webContents.on('did-finish-load', () => {
      void this.refreshStatus();
    });
    sessionWindow.webContents.on('did-navigate-in-page', () => {
      void this.refreshStatus();
    });
    sessionWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      this.updateStatus({ state: 'error', message: '认证页面加载失败，请检查网络后重试' });
    });
    sessionWindow.webContents.on('render-process-gone', () => {
      if (this.sessionWindow === sessionWindow) this.sessionWindow = null;
      if (!sessionWindow.isDestroyed()) sessionWindow.destroy();
      this.updateStatus({ state: 'error', message: '登录页面意外停止，请重新打开登录窗口' });
    });

    sessionWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

    return sessionWindow;
  }

  private startStatusMonitor(): void {
    if (this.statusMonitor) return;
    this.statusMonitor = setInterval(() => {
      void this.refreshStatus();
    }, 1_000);
  }

  private async refreshStatus(): Promise<void> {
    const sessionWindow = this.sessionWindow;
    if (!sessionWindow || sessionWindow.isDestroyed() || sessionWindow.webContents.isLoading()) return;

    const currentUrl = sessionWindow.webContents.getURL();
    let isBookingOrigin = false;
    try {
      isBookingOrigin = new URL(currentUrl).origin === BOOKING_ORIGIN;
    } catch {
      isBookingOrigin = false;
    }

    if (!isBookingOrigin) {
      if (sessionWindow.isVisible()) {
        this.updateStatus({ state: 'authenticating', message: '请在认证窗口中完成登录' });
      } else {
        this.updateStatus({ state: 'unauthenticated', message: '未登录' });
      }
      return;
    }

    try {
      const hasApplicationToken = await sessionWindow.webContents.executeJavaScript(
        "Boolean(window.sessionStorage.getItem('token'))",
        true,
      ) as boolean;

      if (hasApplicationToken) {
        const becameAuthenticated = this.status.state !== 'authenticated';
        this.updateStatus({ state: 'authenticated', message: '登录会话有效' });
        if (becameAuthenticated && sessionWindow.isVisible()) {
          setTimeout(() => {
            if (!sessionWindow.isDestroyed()) sessionWindow.hide();
          }, 600);
        }
      } else if (sessionWindow.isVisible()) {
        this.updateStatus({ state: 'authenticating', message: '请在认证窗口中完成登录' });
      } else {
        this.updateStatus({ state: 'unauthenticated', message: '未登录' });
      }
    } catch {
      this.updateStatus({ state: 'unauthenticated', message: '未检测到有效登录会话' });
    }
  }

  private updateStatus(nextStatus: LoginStatus): void {
    if (this.status.state === nextStatus.state && this.status.message === nextStatus.message) return;
    this.status = nextStatus;
    this.emit('status-changed', this.getStatus());
  }
}

function isTrustedAuthenticationUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    if (!TRUSTED_AUTHENTICATION_HOSTS.has(parsedUrl.hostname)) return false;

    // The booking service currently redirects its CAS entry point to this exact
    // HTTP host before the CAS page is served. No other HTTP host is allowed.
    return parsedUrl.protocol === 'https:'
      || (parsedUrl.protocol === 'http:' && parsedUrl.hostname === 'zjuam.zju.edu.cn');
  } catch {
    return false;
  }
}
