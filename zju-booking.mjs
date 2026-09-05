import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const BOOKING_ORIGIN = 'https://booking.lib.zju.edu.cn';
const BOOKING_PAGE_URL = `${BOOKING_ORIGIN}/h5/index.html#/login`;
const DEFAULT_PROFILE_DIRECTORY = '.zju-booking-profile';
const DEFAULT_QUERY_PAGE_SIZE = 50;
const MAX_QUERY_PAGES = 20;
const MAX_DETAIL_SPACES = 50;
const DEFAULT_QUERY_INTERVAL_MS = 800;

const RESERVATION_TYPES = Object.freeze({
  seat: {
    searchId: 1,
    label: '普通座位',
    categoryId: '1',
  },
  singleStudy: {
    searchId: 2,
    label: '单人研习间',
    categoryId: '2',
  },
  seminar: {
    searchId: 2,
    label: '多人研讨间',
    categoryId: '6',
  },
});

const API_PATHS = Object.freeze({
  reservationMetadata: '/reserve/index/index',
  reservationList: '/reserve/index/list',
  reservationDetail: '/reserve/index/detail',
  seatDates: '/api/Seat/date',
  seatList: '/api/Seat/seat',
  seatConfirm: '/api/Seat/confirm',
  seminarAvailability: '/api/Seminar/v1seminar',
  seminarConfirm: '/reserve/index/confirm',
});

const ENCRYPTION_INITIALIZATION_VECTOR = 'ZZWBKJ_ZHIHUAWEI';

function parseCommandLineArguments(commandLineArguments) {
  const options = {
    command: commandLineArguments[0] || 'help',
    type: 'seat',
    date: 'today',
    premisesId: '53',
    categoryId: '',
    areaId: '',
    roomId: '',
    seatId: '',
    name: '',
    startTime: '',
    endTime: '',
    title: '',
    content: '',
    mobile: '',
    teamusers: '',
    titleId: '',
    segmentId: '',
    intervalMs: DEFAULT_QUERY_INTERVAL_MS,
    profileDirectory: DEFAULT_PROFILE_DIRECTORY,
    confirm: false,
  };

  for (let argumentIndex = 1; argumentIndex < commandLineArguments.length; argumentIndex += 1) {
    const argument = commandLineArguments[argumentIndex];
    if (argument === '--confirm') {
      options.confirm = true;
      continue;
    }
    if (argument.startsWith('--confirm=')) {
      throw new Error('--confirm 不接受值；请单独使用 --confirm。');
    }

    const separatorIndex = argument.indexOf('=');
    if (separatorIndex < 0) {
      throw new Error(`无法识别参数：${argument}。参数必须使用 --name=value 格式。`);
    }

    const optionName = argument.slice(2, separatorIndex);
    const optionValue = argument.slice(separatorIndex + 1);
    if (!optionName || !Object.hasOwn(options, optionName)) {
      throw new Error(`未知参数：${argument}`);
    }

    options[optionName] = ['intervalMs'].includes(optionName)
      ? Number(optionValue)
      : optionValue;
  }

  return options;
}

function printUsage() {
  console.log(`浙江大学图书馆预约 API 工具

先登录（浏览器会打开浙大统一身份认证页面，登录完成后回到终端按 Enter）：
  node zju-booking.mjs login

只读查询：
  node zju-booking.mjs query --type=seat --date=today
  node zju-booking.mjs query --type=singleStudy --date=tomorrow
  node zju-booking.mjs query --type=seminar --date=2026-09-06

可选查询参数：
  --premisesId=53       主馆 ID，默认 53
  --categoryId=2        空间类型筛选；不传时按 --type 自动设置
  --name=5SC01          按空间名称过滤
  --startTime=08:30     目标开始时间
  --endTime=12:00       目标结束时间
  --areaId=125          已知空间区域 ID
  --roomId=58           普通座位所属区域 ID
  --seatId=6046         普通座位 ID
  --segmentId=1554059   普通座位预约的时间段 ID（query 结果中提供）
  --teamusers=成员ID1,成员ID2  多人研讨间参与人 ID（按系统要求填写）
  --titleId=1                 页面要求预设标题时使用的标题 ID
  --intervalMs=800            分页和查询之间的间隔毫秒数
  --profileDirectory=路径     浏览器持久化配置目录

预约：
  node zju-booking.mjs book --type=seat --date=tomorrow --roomId=58 --seatId=6046 --segmentId=1554059 --confirm
  node zju-booking.mjs book --type=singleStudy --date=tomorrow --areaId=125 --startTime=08:30 --endTime=10:00 --title=单人研习 --content=学习 --mobile=你的手机号 --confirm
  node zju-booking.mjs book --type=seminar --date=tomorrow --areaId=206 --startTime=09:00 --endTime=11:00 --title=小组讨论 --content=课程讨论 --mobile=你的手机号 --teamusers=成员ID1,成员ID2 --confirm

安全说明：
  - 不要把账号密码写入命令行或配置文件；使用 login 命令完成正常登录。
  - query 永远只读；book 没有 --confirm 时只显示将要提交的载荷。
  - 真实预约仅允许一次提交，程序不会并发抢占或无限重试。
`);
}

function resolveDate(dateOption) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOption)) {
    const [year, month, day] = dateOption.split('-').map(Number);
    const parsedDate = new Date(year, month - 1, day);
    if (
      Number.isNaN(parsedDate.getTime())
      || parsedDate.getFullYear() !== year
      || parsedDate.getMonth() !== month - 1
      || parsedDate.getDate() !== day
    ) {
      throw new Error(`不是有效日期：${dateOption}`);
    }
    return dateOption;
  }

  const dateOffset = dateOption === 'tomorrow' ? 1 : dateOption === 'today' ? 0 : null;
  if (dateOffset === null) {
    throw new Error('日期必须是 today、tomorrow 或 YYYY-MM-DD。');
  }

  const date = new Date();
  date.setDate(date.getDate() + dateOffset);
  return formatDate(date);
}

function formatDate(date) {
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part, partIndex) => (partIndex === 0 ? String(part) : String(part).padStart(2, '0')))
    .join('-');
}

function resolveReservationType(typeOption) {
  const reservationType = RESERVATION_TYPES[typeOption];
  if (!reservationType) {
    throw new Error('预约类型必须是 seat、singleStudy 或 seminar。');
  }
  return reservationType;
}

function isEnabledFlag(value) {
  return value === true || Number(value) === 1 || ['true', 'yes'].includes(String(value).toLowerCase());
}

function assertValidTime(timeValue, optionName) {
  if (!/^\d{2}:\d{2}$/.test(timeValue)) {
    throw new Error(`${optionName} 必须使用 HH:mm 格式。`);
  }

  const [hour, minute] = timeValue.split(':').map(Number);
  if (hour > 23 || minute > 59) {
    throw new Error(`${optionName} 不是有效时间：${timeValue}`);
  }
}

function assertTimeRange(startTime, endTime) {
  assertValidTime(startTime, '--startTime');
  assertValidTime(endTime, '--endTime');
  if (startTime >= endTime) {
    throw new Error('--startTime 必须早于 --endTime。');
  }
}

function assertRequestedSpaceTimeAvailable(availability, startTime, endTime, spaceLabel) {
  assertTimeRange(startTime, endTime);

  if (availability.date !== undefined && !availability.startTime) {
    throw new Error(`${spaceLabel}在${availability.date}没有可用预约时段。`);
  }

  const requestedStartMinutes = minutesFromTime(startTime);
  const requestedEndMinutes = minutesFromTime(endTime);
  const availableStartMinutes = availability.startTime
    ? minutesFromTime(availability.startTime)
    : null;
  const availableEndMinutes = availability.endTime
    ? minutesFromTime(availability.endTime)
    : null;

  if (
    availableStartMinutes !== null
    && availableEndMinutes !== null
    && (requestedStartMinutes < availableStartMinutes || requestedEndMinutes > availableEndMinutes)
  ) {
    throw new Error(
      `${spaceLabel}可预约时间为 ${availability.startTime}-${availability.endTime}，`
      + `请求时间为 ${startTime}-${endTime}。`,
    );
  }

  const requestedDurationMinutes = requestedEndMinutes - requestedStartMinutes;
  if (
    availability.minDurationMinutes > 0
    && requestedDurationMinutes < availability.minDurationMinutes
  ) {
    throw new Error(`${spaceLabel}预约时长不能少于 ${availability.minDurationMinutes} 分钟。`);
  }
  if (
    availability.maxDurationMinutes > 0
    && requestedDurationMinutes > availability.maxDurationMinutes
  ) {
    throw new Error(`${spaceLabel}预约时长不能超过 ${availability.maxDurationMinutes} 分钟。`);
  }
  if (isIntervalBlocked(startTime, endTime, availability.blockedIntervals)) {
    throw new Error(`${spaceLabel}的时间段与已占用时段冲突。`);
  }
}

function minutesFromTime(timeValue) {
  const [hour, minute] = timeValue.split(':').map(Number);
  return hour * 60 + minute;
}

function timeFromMinutes(totalMinutes) {
  const normalizedMinutes = Math.max(0, Math.min(totalMinutes, 23 * 60 + 59));
  const hour = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function formatApiMinutes(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) return value;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? timeFromMinutes(numericValue) : '';
}

function wait(milliseconds) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function removeEmptyValues(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => {
      if (value === null || value === undefined || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

function assertSuccessfulResponse(responseBody, expectedCodes, endpointPath) {
  if (!responseBody || !expectedCodes.includes(Number(responseBody.code))) {
    const responseMessage = responseBody?.msg || responseBody?.message || '无错误信息';
    throw new Error(`${endpointPath} 返回失败：code=${responseBody?.code}，${responseMessage}`);
  }
}

function createApiPageRequest(page) {
  return async (endpointPath, payload = {}, shouldEncrypt = false) => page.evaluate(async ({
    endpointPath,
    payload,
    shouldEncrypt,
    encryptionInitializationVector,
  }) => {
    const token = sessionStorage.getItem('token') || '';
    if (!token) {
      throw new Error('浏览器会话中没有应用 Token，请重新执行 login 完成登录。');
    }

    const authorization = `bearer${token}`;
    let requestBody;

    if (shouldEncrypt) {
      const dateParts = [
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        new Date().getDate(),
      ];
      const dateKeyText = dateParts
        .map((part, partIndex) => (partIndex === 0
          ? String(part)
          : String(part).padStart(2, '0')))
        .join('');
      const encryptionKeyText = `${dateKeyText}${[...dateKeyText].reverse().join('')}`;
      const textEncoder = new TextEncoder();
      const cryptoKey = await window.crypto.subtle.importKey(
        'raw',
        textEncoder.encode(encryptionKeyText),
        { name: 'AES-CBC' },
        false,
        ['encrypt'],
      );
      const encryptedBytes = await window.crypto.subtle.encrypt(
        { name: 'AES-CBC', iv: textEncoder.encode(encryptionInitializationVector) },
        cryptoKey,
        textEncoder.encode(JSON.stringify(payload)),
      );
      const encryptedByteArray = new Uint8Array(encryptedBytes);
      let binaryText = '';
      for (const byte of encryptedByteArray) binaryText += String.fromCharCode(byte);
      requestBody = {
        aesjson: window.btoa(binaryText),
        authorization,
      };
    } else {
      requestBody = { ...payload, authorization };
    }

    const response = await fetch(endpointPath, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        authorization,
        lang: localStorage.getItem('lang') || 'zh',
      },
      body: JSON.stringify(requestBody),
    });

    let responseBody;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = { code: response.status, msg: '响应不是 JSON' };
    }

    return { httpStatus: response.status, body: responseBody };
  }, {
    endpointPath,
    payload,
    shouldEncrypt,
    encryptionInitializationVector: ENCRYPTION_INITIALIZATION_VECTOR,
  });
}

function createApiClient(page) {
  const request = createApiPageRequest(page);

  return {
    async post(endpointPath, payload, expectedCodes = [0, 1]) {
      const shouldEncrypt = [API_PATHS.seatConfirm, API_PATHS.seminarConfirm]
        .includes(endpointPath);
      const result = await request(endpointPath, payload, shouldEncrypt);
      if (result.httpStatus < 200 || result.httpStatus >= 300) {
        throw new Error(`${endpointPath} HTTP 状态异常：${result.httpStatus}`);
      }
      assertSuccessfulResponse(result.body, expectedCodes, endpointPath);
      return result.body;
    },
  };
}

async function waitForAuthenticatedPage(page) {
  await page.goto(BOOKING_PAGE_URL, { waitUntil: 'domcontentloaded' });
  const hasToken = await waitForSessionToken(page, 10_000);
  if (hasToken) return;

  console.log('浏览器中尚未检测到应用会话。请在打开的页面中完成正常登录。');
  console.log('登录完成后回到终端按 Enter 继续；不会读取或打印密码。');
  const terminalInterface = readline.createInterface({ input, output });
  await terminalInterface.question('登录完成后按 Enter：');
  terminalInterface.close();

  const authenticatedAfterPrompt = await waitForSessionToken(page, 5_000);
  if (!authenticatedAfterPrompt) {
    throw new Error('仍未检测到有效会话。请确认已经完成登录并回到预约系统页面。');
  }
}

async function waitForSessionToken(page, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const hasToken = await page.evaluate(() => Boolean(sessionStorage.getItem('token')));
    if (hasToken) return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function launchBookingBrowser(profileDirectory) {
  const browserContext = await chromium.launchPersistentContext(profileDirectory, {
    headless: false,
    viewport: { width: 1280, height: 850 },
  });

  const existingPage = browserContext.pages()[0];
  const page = existingPage || await browserContext.newPage();
  page.setDefaultTimeout(60_000);
  return { browserContext, page };
}

async function fetchReservationMetadata(apiClient, reservationSearchId = 2) {
  return apiClient.post(API_PATHS.reservationMetadata, { id: reservationSearchId }, [0]);
}

function summarizeMetadata(metadataBody) {
  const data = metadataBody.data || {};
  return {
    premises: (data.premises || []).map((item) => ({ id: item.id, name: item.name })),
    categories: (data.category || []).map((item) => ({ id: item.id, name: item.name })),
    dates: data.date || [],
    openTime: data.spaceTime?.spaceOpenTime,
    closeTime: data.spaceTime?.spaceCloseTime,
  };
}

async function fetchSpaceList(
  apiClient,
  options,
  reservationType,
  bookingDate,
  requestIntervalMilliseconds = 0,
) {
  const categoryId = options.categoryId || reservationType.categoryId;
  const spaces = [];
  let pageNumber = 1;
  let totalPageCount = 1;

  do {
    const listPayload = removeEmptyValues({
      id: reservationType.searchId,
      name: options.name,
      date: bookingDate,
      premisesIds: options.premisesId ? [options.premisesId] : [],
      categoryIds: [categoryId],
      startTime: options.startTime,
      endTime: options.endTime,
      size: DEFAULT_QUERY_PAGE_SIZE,
      page: pageNumber,
    });

    const responseBody = await apiClient.post(API_PATHS.reservationList, listPayload, [0]);
    const responseData = responseBody.data || {};
    const pageItems = responseData.list || [];
    spaces.push(...pageItems.map((item) => ({
      id: item.id,
      parentId: item.parentId,
      topId: item.topId,
      name: item.nameMerge,
      typeId: item.type_id,
      typeName: item.type_name,
      fullyBooked: isEnabledFlag(item.Fully_Booked),
      minPerson: item.minPerson,
      maxPerson: item.maxPerson,
      freeNumber: item.free_num,
      totalNumber: item.total_num,
    })));

    const reportedTotalPageCount = Number(responseData.totalPage);
    if (Number.isFinite(reportedTotalPageCount) && reportedTotalPageCount > 0) {
      totalPageCount = Math.min(reportedTotalPageCount, MAX_QUERY_PAGES);
    } else if (pageItems.length >= DEFAULT_QUERY_PAGE_SIZE) {
      // Some deployments omit totalPage. A full page is a conservative signal
      // to continue until an empty/short page or the safety cap is reached.
      totalPageCount = MAX_QUERY_PAGES;
    } else {
      totalPageCount = pageNumber;
    }
    if (!pageItems.length) break;

    pageNumber += 1;
    if (pageNumber <= totalPageCount) await wait(requestIntervalMilliseconds);
  } while (pageNumber <= totalPageCount);

  return spaces;
}

async function fetchSpaceDetail(apiClient, areaId, bookingDate) {
  const responseBody = await apiClient.post(API_PATHS.reservationDetail, {
    id: 2,
    areaId,
    date: bookingDate,
  }, [0]);

  return responseBody.data || {};
}

async function fetchSeatAvailability(
  apiClient,
  areaId,
  bookingDate,
  requestedStartTime = '',
  requestedEndTime = '',
  requestedSegmentId = '',
) {
  if (Boolean(requestedStartTime) !== Boolean(requestedEndTime)) {
    throw new Error('指定座位时间段时必须同时提供 --startTime 和 --endTime。');
  }
  if (requestedStartTime && requestedEndTime) {
    assertTimeRange(requestedStartTime, requestedEndTime);
  }

  const dateResponse = await apiClient.post(API_PATHS.seatDates, { build_id: areaId }, [1]);
  const dateEntry = (dateResponse.data || []).find((item) => item.day === bookingDate);
  if (!dateEntry) return { date: bookingDate, segments: [], seats: [] };

  const availableSegments = (dateEntry.times || [])
    .filter((segment) => isEnabledFlag(segment.status))
    .filter((segment) => (
      !requestedSegmentId || String(segment.id) === String(requestedSegmentId)
    ))
    .filter((segment) => doesSegmentContainInterval(
      { start: segment.start, end: segment.end },
      requestedStartTime,
      requestedEndTime,
    ));
  const segmentResults = [];
  const seatsWithSegments = [];

  for (const segment of availableSegments) {
    const seatResponse = await apiClient.post(API_PATHS.seatList, {
      area: areaId,
      segment: segment.id,
      day: dateEntry.day,
      startTime: segment.start,
      endTime: segment.end,
    }, [1]);

    const seats = (seatResponse.data || []).map((seat) => ({
      id: seat.id,
      name: seat.name || seat.no,
      status: String(seat.status),
      available: isEnabledFlag(seat.status),
      statusName: seat.status_name,
      areaId: seat.area,
      segmentId: segment.id,
      startTime: segment.start,
      endTime: segment.end,
    }));
    seatsWithSegments.push(...seats);
    segmentResults.push({
      id: segment.id,
      startTime: segment.start,
      endTime: segment.end,
      availableSeatCount: seats.filter((seat) => seat.available).length,
    });
  }

  return {
    date: dateEntry.day,
    segments: segmentResults,
    seats: seatsWithSegments,
  };
}

async function fetchSpaceAvailability(apiClient, areaId, buildingId, bookingDate) {
  const responseBody = await apiClient.post(API_PATHS.seminarAvailability, {
    room: areaId,
    area: buildingId,
  }, [1]);

  const dateEntry = (responseBody.data?.list || []).find((item) => item.date === bookingDate);
  const availabilityInfo = dateEntry?.info || {};
  const blockedIntervals = (availabilityInfo.list || []).map((interval) => {
    const startTime = formatApiMinutes(interval.beginNum);
    const endTime = formatApiMinutes(interval.endNum);
    return startTime && endTime ? { startTime, endTime } : null;
  }).filter(Boolean);

  return {
    date: bookingDate,
    fullyBooked: isEnabledFlag(availabilityInfo.Fully_Booked),
    startTime: formatApiMinutes(availabilityInfo.startTime),
    endTime: formatApiMinutes(availabilityInfo.endTime),
    minDurationMinutes: Number(availabilityInfo.minTime || 0),
    maxDurationMinutes: Number(availabilityInfo.maxTime || 0),
    blockedIntervals,
    minPerson: Number(availabilityInfo.minPerson || 0),
    maxPerson: Number(availabilityInfo.maxPerson || 0),
  };
}

async function fetchSpaceReservationAvailability(apiClient, areaId, buildingId, bookingDate) {
  const spaceDetail = await fetchSpaceDetail(apiClient, areaId, bookingDate);
  const effectiveBuildingId = spaceDetail.topId || spaceDetail.parentId || buildingId;
  const availability = await fetchSpaceAvailability(
    apiClient,
    areaId,
    effectiveBuildingId,
    bookingDate,
  );
  return { spaceDetail, availability };
}

function isIntervalBlocked(startTime, endTime, blockedIntervals = []) {
  const requestedStart = minutesFromTime(startTime);
  const requestedEnd = minutesFromTime(endTime);
  return blockedIntervals.some((interval) => (
    requestedStart < minutesFromTime(interval.endTime)
      && requestedEnd > minutesFromTime(interval.startTime)
  ));
}

function doesSegmentContainInterval(segment, requestedStartTime, requestedEndTime) {
  if (!requestedStartTime && !requestedEndTime) return true;
  if (!requestedStartTime || !requestedEndTime) {
    throw new Error('指定时间段时必须同时提供 --startTime 和 --endTime。');
  }
  assertTimeRange(requestedStartTime, requestedEndTime);
  return minutesFromTime(segment.start) <= minutesFromTime(requestedStartTime)
    && minutesFromTime(segment.end) >= minutesFromTime(requestedEndTime);
}

function buildSeatConfirmationPayload(seat) {
  if (!seat?.id) throw new Error('普通座位预约必须提供 --seatId，或先从 query 结果中选择座位。');
  if (!seat.segmentId) throw new Error('普通座位缺少时间段 segmentId，请重新 query 后使用该结果。');

  return {
    seat_id: String(seat.id),
    segment: String(seat.segmentId),
  };
}

function buildSpaceConfirmationPayload(options, bookingDate, areaId, spaceDetail = {}) {
  assertTimeRange(options.startTime, options.endTime);
  if (!options.title || !options.content || !options.mobile) {
    throw new Error('空间预约需要 --title、--content 和 --mobile。');
  }

  const payload = {
    id: 2,
    day: bookingDate,
    start_time: options.startTime,
    end_time: options.endTime,
    title: options.title,
    content: options.content,
    mobile: options.mobile,
    room: String(areaId),
    open: '1',
    file_name: '',
    file_url: '',
  };

  const participantIds = parseTeamUserIds(options.teamusers);
  if (participantIds.length > 0) payload.teamusers = participantIds.join(',');

  const availableTitleOptions = Array.isArray(spaceDetail.title) ? spaceDetail.title : [];
  const selectedTitleId = options.titleId || availableTitleOptions.find(
    (titleOption) => titleOption.title === options.title,
  )?.id;
  if (
    options.titleId
    && availableTitleOptions.length > 0
    && !availableTitleOptions.some((titleOption) => String(titleOption.id) === String(options.titleId))
  ) {
    throw new Error('提供的 --titleId 不属于该空间的预设标题选项。');
  }
  const requiresPresetTitle = String(spaceDetail.readonlyTitle) === '1';
  if (requiresPresetTitle && !selectedTitleId) {
    throw new Error('该空间要求选择预设标题，请提供匹配的 --title 或 --titleId。');
  }
  if (selectedTitleId) payload.titleId = String(selectedTitleId);

  return payload;
}

function parseTeamUserIds(teamusers) {
  if (!teamusers) return [];

  return String(teamusers)
    .split(',')
    .map((userId) => userId.trim())
    .filter(Boolean);
}

function assertSeminarParticipantCount(options, availability) {
  const participantIds = parseTeamUserIds(options.teamusers);
  const minimumPersonCount = Number(availability.minPerson || 0);
  const maximumPersonCount = Number(availability.maxPerson || 0);

  // The account submitting the form counts as one participant. The site expects
  // teamusers to contain only the additional member IDs.
  const totalParticipantCount = participantIds.length + 1;
  if (minimumPersonCount > 0 && totalParticipantCount < minimumPersonCount) {
    throw new Error(`该研讨间至少需要 ${minimumPersonCount} 人，请补充 --teamusers。`);
  }
  if (maximumPersonCount > 0 && totalParticipantCount > maximumPersonCount) {
    throw new Error(`该研讨间最多容纳 ${maximumPersonCount} 人，请减少 --teamusers。`);
  }
}

function buildSingleStudyConfirmationPayload(options, bookingDate, areaId, spaceDetail) {
  return buildSpaceConfirmationPayload(options, bookingDate, areaId, spaceDetail);
}

function buildSeminarConfirmationPayload(options, bookingDate, areaId, spaceDetail) {
  return buildSpaceConfirmationPayload(options, bookingDate, areaId, spaceDetail);
}

function maskPayloadForDisplay(payload) {
  const displayPayload = structuredClone(payload);

  if (displayPayload.mobile) {
    const mobileText = String(displayPayload.mobile);
    displayPayload.mobile = mobileText.length >= 7
      ? `${mobileText.slice(0, 3)}****${mobileText.slice(-4)}`
      : '***';
  }
  if (displayPayload.teamusers) displayPayload.teamusers = '[已提供]';

  return displayPayload;
}

function printJson(label, value) {
  console.log(`\n${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function handleLogin(options) {
  const { browserContext, page } = await launchBookingBrowser(options.profileDirectory);
  try {
    await waitForAuthenticatedPage(page);
    console.log(
      `登录会话已建立。浏览器配置保存在 ${options.profileDirectory}/，该目录已加入忽略列表。`,
    );
  } finally {
    await browserContext.close();
  }
}

async function handleQuery(options) {
  const reservationType = resolveReservationType(options.type);
  const bookingDate = resolveDate(options.date);
  const { browserContext, page } = await launchBookingBrowser(options.profileDirectory);

  try {
    await waitForAuthenticatedPage(page);
    const apiClient = createApiClient(page);

    if (options.type === 'seat') {
      const metadataBody = await fetchReservationMetadata(apiClient, reservationType.searchId);
      const premises = summarizeMetadata(metadataBody).premises;
      const spaceList = await fetchSpaceList(
        apiClient,
        options,
        reservationType,
        bookingDate,
        options.intervalMs,
      );
      const selectedAreaIds = options.areaId || options.roomId
        ? [options.areaId || options.roomId]
        : spaceList.map((space) => space.id);
      const areaResults = [];

      for (const areaId of selectedAreaIds) {
        const availability = await fetchSeatAvailability(
          apiClient,
          areaId,
          bookingDate,
          options.startTime,
          options.endTime,
          options.segmentId,
        );
        areaResults.push({
          area: spaceList.find((space) => String(space.id) === String(areaId)) || { id: areaId },
          availability,
        });
        await wait(options.intervalMs);
      }

      printJson('普通座位查询结果', {
        date: bookingDate,
        premises,
        areas: spaceList,
        areaResults,
      });
      return;
    }

    const metadataBody = await fetchReservationMetadata(apiClient, reservationType.searchId);
    const metadata = summarizeMetadata(metadataBody);
    const spaceList = await fetchSpaceList(
      apiClient,
      options,
      reservationType,
      bookingDate,
      options.intervalMs,
    );
    const results = [];

    for (const space of spaceList.slice(0, MAX_DETAIL_SPACES)) {
      const detail = await fetchSpaceDetail(apiClient, space.id, bookingDate);
      const availability = await fetchSpaceAvailability(
        apiClient,
        space.id,
        space.topId || space.parentId || options.premisesId,
        bookingDate,
      );
      results.push({
        space,
        detail: {
          id: detail.id,
          name: detail.nameMerge,
          typeId: detail.type_id,
          typeName: detail.type_name,
          fullyBooked: detail.Fully_Booked,
          titleOptions: detail.title,
          readonlyTitle: detail.readonlyTitle,
          minPerson: detail.minPerson,
          maxPerson: detail.maxPerson,
        },
        availability,
      });
      await wait(options.intervalMs);
    }

    printJson(`${reservationType.label}查询结果`, {
      date: bookingDate,
      metadata,
      results,
    });
  } finally {
    await browserContext.close();
  }
}

async function handleBook(options) {
  const reservationType = resolveReservationType(options.type);
  const bookingDate = resolveDate(options.date);
  const { browserContext, page } = await launchBookingBrowser(options.profileDirectory);

  try {
    await waitForAuthenticatedPage(page);
    const apiClient = createApiClient(page);
    let confirmationPayload;
    let endpointPath;

    if (options.type === 'seat') {
      const areaId = options.areaId || options.roomId;
      if (!areaId) throw new Error('普通座位预约需要 --roomId=座位区域ID。');
      if (!options.seatId) throw new Error('普通座位预约需要 --seatId=具体座位ID。');
      if (!options.segmentId) {
        throw new Error('普通座位预约需要 --segmentId=时间段ID，请先 query 获取目标时间段。');
      }

      const availability = await fetchSeatAvailability(
        apiClient,
        areaId,
        bookingDate,
        options.startTime,
        options.endTime,
        options.segmentId,
      );
      const selectedSeat = availability.seats.find((seat) => (
        String(seat.id) === String(options.seatId)
        && seat.available
        && String(seat.segmentId) === String(options.segmentId)
      ));
      if (!selectedSeat) {
        throw new Error('指定座位在目标日期/时间段不可预约；请重新 query，并指定 --segmentId。');
      }
      confirmationPayload = buildSeatConfirmationPayload(selectedSeat);
      endpointPath = API_PATHS.seatConfirm;
    } else if (options.type === 'singleStudy') {
      const areaId = options.areaId;
      if (!areaId) throw new Error('单人研习间预约需要 --areaId=空间ID。');
      const { spaceDetail, availability } = await fetchSpaceReservationAvailability(
        apiClient,
        areaId,
        options.premisesId,
        bookingDate,
      );
      if (String(spaceDetail.type_id) !== '2') {
        throw new Error(`空间 ${areaId} 不是单人研习间，请重新 query 确认 ID。`);
      }
      if (availability.fullyBooked) throw new Error('指定单人研习间在该日期已约满。');
      assertRequestedSpaceTimeAvailable(
        availability,
        options.startTime,
        options.endTime,
        `单人研习间 ${areaId}`,
      );
      confirmationPayload = buildSingleStudyConfirmationPayload(
        options,
        bookingDate,
        areaId,
        spaceDetail,
      );
      endpointPath = API_PATHS.seminarConfirm;
    } else {
      const areaId = options.areaId;
      if (!areaId) throw new Error('多人研讨间预约需要 --areaId=空间区域ID。');
      const { spaceDetail, availability } = await fetchSpaceReservationAvailability(
        apiClient,
        areaId,
        options.premisesId,
        bookingDate,
      );
      if (String(spaceDetail.type_id) !== '6') {
        throw new Error(`空间 ${areaId} 不是多人研讨间，请重新 query 确认 ID。`);
      }
      if (availability.fullyBooked) throw new Error('指定多人研讨间在该日期已约满。');
      assertRequestedSpaceTimeAvailable(
        availability,
        options.startTime,
        options.endTime,
        `多人研讨间 ${areaId}`,
      );
      assertSeminarParticipantCount(options, availability);
      confirmationPayload = buildSeminarConfirmationPayload(
        options,
        bookingDate,
        areaId,
        spaceDetail,
      );
      endpointPath = API_PATHS.seminarConfirm;
    }

    printJson('预约预览（尚未提交）', {
      type: reservationType.label,
      date: bookingDate,
      endpoint: endpointPath,
      payload: maskPayloadForDisplay(confirmationPayload),
    });

    if (!options.confirm) {
      console.log('\n未指定 --confirm，因此没有发送预约请求。');
      return;
    }

    const terminalInterface = readline.createInterface({ input, output });
    const confirmation = await terminalInterface.question('\n输入 BOOK_CONFIRM 才会提交一次预约：');
    terminalInterface.close();
    if (confirmation.trim() !== 'BOOK_CONFIRM') {
      console.log('未获得确认口令，已取消提交。');
      return;
    }

    const responseBody = await apiClient.post(endpointPath, confirmationPayload, [0, 1]);
    printJson('预约接口响应', {
      code: responseBody.code,
      message: responseBody.msg || responseBody.message,
      data: responseBody.data,
    });
  } finally {
    await browserContext.close();
  }
}

async function main() {
  const options = parseCommandLineArguments(process.argv.slice(2));
  if (options.command === 'help' || options.command === '--help') {
    printUsage();
    return;
  }

  if (!['login', 'query', 'book'].includes(options.command)) {
    throw new Error(`未知命令：${options.command}`);
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 0) {
    throw new Error('--intervalMs 必须是非负数字。');
  }

  if (options.command === 'login') await handleLogin(options);
  if (options.command === 'query') await handleQuery(options);
  if (options.command === 'book') await handleBook(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n操作失败：${error.message}`);
    process.exitCode = 1;
  });
}

export {
  assertTimeRange,
  buildSeminarConfirmationPayload,
  buildSingleStudyConfirmationPayload,
  buildSeatConfirmationPayload,
  assertRequestedSpaceTimeAvailable,
  assertSeminarParticipantCount,
  doesSegmentContainInterval,
  isIntervalBlocked,
  parseCommandLineArguments,
  removeEmptyValues,
  resolveDate,
};
