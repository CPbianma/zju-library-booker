import type { WebContents } from 'electron';

import { BookingSessionService } from './booking-session';

const REQUEST_INTERVAL_MILLISECONDS = 800;

type ReadOnlyOperation =
  | 'reservationMetadata'
  | 'reservationList'
  | 'reservationDetail'
  | 'seatDates'
  | 'seatList'
  | 'seminarAvailability';

const READ_ONLY_OPERATION_CONFIGURATION: Record<ReadOnlyOperation, {
  endpointPath: string;
  expectedCodes: number[];
}> = {
  reservationMetadata: { endpointPath: '/reserve/index/index', expectedCodes: [0] },
  reservationList: { endpointPath: '/reserve/index/list', expectedCodes: [0] },
  reservationDetail: { endpointPath: '/reserve/index/detail', expectedCodes: [0] },
  seatDates: { endpointPath: '/api/Seat/date', expectedCodes: [1] },
  seatList: { endpointPath: '/api/Seat/seat', expectedCodes: [1] },
  seminarAvailability: { endpointPath: '/api/Seminar/v1seminar', expectedCodes: [1] },
};

interface PageRequestArguments {
  operation: ReadOnlyOperation;
  payload: Record<string, unknown>;
}

interface PageRequestResult {
  httpStatus: number;
  responseWasJson: boolean;
  body: unknown;
}

interface ApiResponseBody {
  code: number | string;
  msg?: string;
  message?: string;
  data?: unknown;
}

export class BookingApiService {
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestStartedAt = 0;

  public constructor(private readonly sessionService: BookingSessionService) {}

  public fetchReservationMetadata(payload: Record<string, unknown>) {
    return this.request('reservationMetadata', payload);
  }

  public fetchReservationList(payload: Record<string, unknown>) {
    return this.request('reservationList', payload);
  }

  public fetchReservationDetail(payload: Record<string, unknown>) {
    return this.request('reservationDetail', payload);
  }

  public fetchSeatDates(payload: Record<string, unknown>) {
    return this.request('seatDates', payload);
  }

  public fetchSeatList(payload: Record<string, unknown>) {
    return this.request('seatList', payload);
  }

  public fetchSeminarAvailability(payload: Record<string, unknown>) {
    return this.request('seminarAvailability', payload);
  }

  private async request(
    operation: ReadOnlyOperation,
    payload: Record<string, unknown>,
  ): Promise<ApiResponseBody> {
    const requestResult = this.requestQueue.then(() => this.performRequest(operation, payload));
    this.requestQueue = requestResult.then(
      () => undefined,
      () => undefined,
    );
    return requestResult;
  }

  private async performRequest(
    operation: ReadOnlyOperation,
    payload: Record<string, unknown>,
  ): Promise<ApiResponseBody> {
    const configuration = READ_ONLY_OPERATION_CONFIGURATION[operation];
    let webContents: WebContents;
    try {
      webContents = await this.sessionService.getAuthenticatedWebContents();
    } catch (error) {
      throw new FatalQueryError(getErrorMessage(error));
    }
    assertBookingOrigin(webContents.getURL());
    await this.waitForRequestWindow();

    let rawResult: unknown;
    try {
      rawResult = await this.executePageRequest(webContents, { operation, payload });
    } catch (error) {
      throw new FatalQueryError(`只读查询失败：${getErrorMessage(error)}`);
    }
    const result = validatePageRequestResult(rawResult);
    if (result.httpStatus < 200 || result.httpStatus >= 300) {
      throw new FatalQueryError(
        `${configuration.endpointPath} 请求失败，HTTP ${result.httpStatus}`,
      );
    }
    if (!result.responseWasJson) {
      throw new FatalQueryError(`${configuration.endpointPath} 返回了非 JSON 响应。`);
    }
    const responseBody = validateApiResponseBody(result.body, configuration.endpointPath);

    const responseCode = Number(responseBody.code);
    if (!configuration.expectedCodes.includes(responseCode)) {
      if (responseCode === 10001) {
        this.sessionService.markUnauthenticated();
        throw new FatalQueryError('登录会话已失效，请重新登录。');
      }
      const responseMessage = responseBody.msg || responseBody.message || '无错误信息';
      throw new Error(`${configuration.endpointPath} 返回失败：${responseMessage}`);
    }

    return responseBody;
  }

  private async executePageRequest(
    webContents: WebContents,
    argumentsValue: PageRequestArguments,
  ): Promise<unknown> {
    const serializedArguments = JSON.stringify(argumentsValue);
    const scriptSource = `(${runReadOnlyPageRequest.toString()})(${serializedArguments})`;
    return webContents.executeJavaScript(scriptSource, true) as Promise<unknown>;
  }

  private async waitForRequestWindow(): Promise<void> {
    const elapsedMilliseconds = Date.now() - this.lastRequestStartedAt;
    const waitMilliseconds = Math.max(0, REQUEST_INTERVAL_MILLISECONDS - elapsedMilliseconds);
    if (waitMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
    }
    this.lastRequestStartedAt = Date.now();
  }
}

async function runReadOnlyPageRequest(
  argumentsValue: PageRequestArguments,
): Promise<PageRequestResult> {
  const operationPaths: Record<ReadOnlyOperation, string> = {
    reservationMetadata: '/reserve/index/index',
    reservationList: '/reserve/index/list',
    reservationDetail: '/reserve/index/detail',
    seatDates: '/api/Seat/date',
    seatList: '/api/Seat/seat',
    seminarAvailability: '/api/Seminar/v1seminar',
  };
  if (window.location.origin !== 'https://booking.lib.zju.edu.cn') {
    throw new Error('只读查询只能在图书馆预约系统页面中执行。');
  }
  const endpointPath = operationPaths[argumentsValue.operation];
  if (!endpointPath) throw new Error('拒绝未知的只读查询操作。');

  const token = window.sessionStorage.getItem('token') || '';
  if (!token) throw new Error('浏览器会话中没有应用 Token，请重新登录。');

  const authorization = token.startsWith('bearer') ? token : `bearer${token}`;
  const requestBody = {
    ...argumentsValue.payload,
    authorization,
  };
  const response = await fetch(`https://booking.lib.zju.edu.cn${endpointPath}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      authorization,
      lang: window.localStorage.getItem('lang') || 'zh',
    },
    body: JSON.stringify(requestBody),
  });

  let responseBody: unknown;
  let responseWasJson = true;
  try {
    responseBody = await response.json() as unknown;
  } catch {
    responseWasJson = false;
    responseBody = null;
  }

  return {
    httpStatus: response.status,
    responseWasJson,
    body: responseBody,
  };
}

export class FatalQueryError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'FatalQueryError';
  }
}

function assertBookingOrigin(url: string): void {
  try {
    if (new URL(url).origin === 'https://booking.lib.zju.edu.cn') return;
  } catch {
    // Fall through to the guarded error below.
  }
  throw new FatalQueryError('登录页面当前不在图书馆预约系统，请重新登录。');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知网络错误';
}

function validatePageRequestResult(value: unknown): PageRequestResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FatalQueryError('只读请求返回了无效的页面响应。');
  }
  const result = value as Record<string, unknown>;
  if (!Number.isInteger(result.httpStatus) || typeof result.responseWasJson !== 'boolean') {
    throw new FatalQueryError('只读请求的页面响应结构不符合预期。');
  }
  return {
    httpStatus: result.httpStatus as number,
    responseWasJson: result.responseWasJson,
    body: result.body,
  };
}

function validateApiResponseBody(value: unknown, endpointPath: string): ApiResponseBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FatalQueryError(`${endpointPath} 返回了无效的响应体。`);
  }
  const responseBody = value as Record<string, unknown>;
  if (typeof responseBody.code !== 'number' && typeof responseBody.code !== 'string') {
    throw new FatalQueryError(`${endpointPath} 响应缺少有效状态码。`);
  }
  return responseBody as unknown as ApiResponseBody;
}
