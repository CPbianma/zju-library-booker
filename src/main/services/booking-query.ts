import type {
  BlockedInterval,
  BookingCandidate,
  QueryFilters,
  QueryMetadata,
  QueryResponse,
  ReservationType,
  SeatCandidate,
  SpaceCandidate,
  TitleOption,
} from '../../shared/contracts';
import { BookingApiService, FatalQueryError } from './booking-api';

const MAIN_LIBRARY_ID = '53';
const QUERY_PAGE_SIZE = 50;
const MAX_QUERY_PAGES = 20;
const MAX_SPACE_DETAILS = 50;
const MAX_SEAT_AREAS = 30;

const RESERVATION_CONFIGURATION: Record<ReservationType, {
  searchId: number;
  categoryId: string;
}> = {
  seat: { searchId: 1, categoryId: '1' },
  singleStudy: { searchId: 2, categoryId: '2' },
  seminar: { searchId: 2, categoryId: '6' },
};

type UnknownRecord = Record<string, unknown>;

export class BookingQueryService {
  private queryIsRunning = false;

  public constructor(private readonly apiService: BookingApiService) {}

  public async query(filters: QueryFilters): Promise<QueryResponse> {
    if (this.queryIsRunning) {
      throw new Error('已有查询正在执行，请等待当前查询完成。');
    }

    this.queryIsRunning = true;
    try {
      const configuration = RESERVATION_CONFIGURATION[filters.type];
      const metadata = await this.fetchMetadata(configuration.searchId);
      const notices: string[] = [];
      const areas = await this.fetchAreaList(filters, configuration.searchId, configuration.categoryId);
      const candidates = filters.type === 'seat'
        ? await this.fetchSeatCandidates(filters, areas, notices)
        : await this.fetchSpaceCandidates(filters, areas, notices);

      return {
        queriedAt: new Date().toISOString(),
        filters,
        metadata,
        candidates,
        notices,
      };
    } finally {
      this.queryIsRunning = false;
    }
  }

  private async fetchMetadata(searchId: number): Promise<QueryMetadata> {
    const responseBody = await this.apiService.fetchReservationMetadata({ id: searchId });
    const data = requireRecord(responseBody.data, '预约元数据 data');
    const premises = requireArray(data.premises, '预约元数据 premises');
    const categories = requireArray(data.category, '预约元数据 category');
    const dates = requireArray(data.date, '预约元数据 date');

    return {
      premises: premises.map(asRecord).map((item) => ({
        id: asString(item.id),
        name: asString(item.name),
      })).filter((item) => item.id && item.name),
      categories: categories.map(asRecord).map((item) => ({
        id: asString(item.id),
        name: asString(item.name),
      })).filter((item) => item.id && item.name),
      availableDates: dates.map((item) => {
        const dateItem = asRecord(item);
        return asString(dateItem.day || dateItem.date || item);
      }).filter(Boolean),
    };
  }

  private async fetchAreaList(
    filters: QueryFilters,
    searchId: number,
    categoryId: string,
  ): Promise<UnknownRecord[]> {
    const areas: UnknownRecord[] = [];
    let pageNumber = 1;
    let totalPageCount = 1;

    do {
      const payload: UnknownRecord = {
        id: searchId,
        date: filters.date,
        premisesIds: [MAIN_LIBRARY_ID],
        categoryIds: [categoryId],
        size: QUERY_PAGE_SIZE,
        page: pageNumber,
      };
      if (filters.type !== 'seat' && filters.name) payload.name = filters.name;
      if (filters.type !== 'seat' && filters.startTime) payload.startTime = filters.startTime;
      if (filters.type !== 'seat' && filters.endTime) payload.endTime = filters.endTime;

      const responseBody = await this.apiService.fetchReservationList(payload);
      const responseData = requireRecord(responseBody.data, '空间列表 data');
      const pageItems = requireArray(responseData.list, '空间列表 data.list').map(asRecord);
      areas.push(...pageItems);

      const reportedTotalPageCount = Number(responseData.totalPage);
      if (Number.isFinite(reportedTotalPageCount) && reportedTotalPageCount > 0) {
        totalPageCount = Math.min(reportedTotalPageCount, MAX_QUERY_PAGES);
      } else {
        totalPageCount = pageItems.length >= QUERY_PAGE_SIZE ? MAX_QUERY_PAGES : pageNumber;
      }

      pageNumber += 1;
    } while (pageNumber <= totalPageCount);

    return areas;
  }

  private async fetchSeatCandidates(
    filters: QueryFilters,
    areas: UnknownRecord[],
    notices: string[],
  ): Promise<SeatCandidate[]> {
    const selectedAreas = filters.areaId
      ? areas.filter((area) => asString(area.id) === filters.areaId)
      : areas.filter((area) => matchesFloor(area, filters.floor));

    if (filters.areaId && selectedAreas.length === 0) {
      selectedAreas.push({
        id: filters.areaId,
        nameMerge: `主馆-指定区域-${filters.areaId}`,
      });
    }
    if (selectedAreas.length > MAX_SEAT_AREAS) {
      notices.push(`座位区域超过 ${MAX_SEAT_AREAS} 个，本次仅查询前 ${MAX_SEAT_AREAS} 个。`);
    }

    const candidates: SeatCandidate[] = [];
    for (const area of selectedAreas.slice(0, MAX_SEAT_AREAS)) {
      const areaId = asString(area.id);
      const areaName = asString(area.nameMerge || area.name || areaId);
      if (!areaId) continue;

      try {
        const dateResponse = await this.apiService.fetchSeatDates({ build_id: areaId });
        const dateEntry = requireArray(dateResponse.data, '座位日期 data')
          .map(asRecord)
          .find((item) => asString(item.day) === filters.date);
        if (!dateEntry) {
          notices.push(`${areaName} 在 ${filters.date} 没有可预约时间段。`);
          continue;
        }

        const segments = requireArray(dateEntry.times, '座位日期 times')
          .map(asRecord)
          .filter((segment) => isEnabled(segment.status))
          .filter((segment) => segmentContainsRequestedTime(segment, filters));

        for (const segment of segments) {
          const segmentId = asString(segment.id);
          const segmentStartTime = asString(segment.start);
          const segmentEndTime = asString(segment.end);
          if (
            !segmentId
            || !isTime(segmentStartTime)
            || !isTime(segmentEndTime)
            || minutesFromTime(segmentStartTime) >= minutesFromTime(segmentEndTime)
          ) {
            throw new ResponseShapeError('座位时间段包含无效的 ID 或时间范围。');
          }

          const seatResponse = await this.apiService.fetchSeatList({
            area: areaId,
            segment: segmentId,
            day: filters.date,
            startTime: segmentStartTime,
            endTime: segmentEndTime,
          });

          const seatItems = requireArray(seatResponse.data, '座位列表 data').map(asRecord);
          for (const seat of seatItems) {
            const seatId = asString(seat.id);
            const seatName = asString(seat.name || seat.no || seatId);
            if (!seatId || !matchesName(seatName, filters.name)) continue;
            const available = isEnabled(seat.status);
            const { floor, location } = parseLocation(areaName);
            candidates.push({
              key: `seat:${areaId}:${segmentId}:${seatId}`,
              kind: 'seat',
              type: 'seat',
              queryDate: filters.date,
              targetId: seatId,
              name: seatName,
              location,
              floor,
              available,
              statusLabel: available ? '空闲' : asString(seat.status_name || '不可预约'),
              areaId,
              areaName,
              segmentId,
              actualStartTime: segmentStartTime,
              actualEndTime: segmentEndTime,
            });
          }
        }
      } catch (error) {
        if (error instanceof FatalQueryError || error instanceof ResponseShapeError) throw error;
        notices.push(`${areaName} 查询失败：${getErrorMessage(error)}`);
      }
    }

    return candidates;
  }

  private async fetchSpaceCandidates(
    filters: QueryFilters,
    areas: UnknownRecord[],
    notices: string[],
  ): Promise<SpaceCandidate[]> {
    const matchingAreas = areas
      .filter((area) => matchesFloor(area, filters.floor))
      .filter((area) => !filters.areaId || asString(area.id) === filters.areaId);
    if (filters.areaId && matchingAreas.length === 0) {
      matchingAreas.push({ id: filters.areaId, nameMerge: `主馆-指定空间-${filters.areaId}` });
    }
    if (matchingAreas.length > MAX_SPACE_DETAILS) {
      notices.push(`空间超过 ${MAX_SPACE_DETAILS} 个，本次仅展开前 ${MAX_SPACE_DETAILS} 个详情。`);
    }

    const candidates: SpaceCandidate[] = [];
    for (const area of matchingAreas.slice(0, MAX_SPACE_DETAILS)) {
      const areaId = asString(area.id);
      const fallbackName = asString(area.nameMerge || area.name || areaId);
      if (!areaId) continue;

      try {
        const detailResponse = await this.apiService.fetchReservationDetail({
          id: 2,
          areaId,
          date: filters.date,
        });
        const detail = requireRecord(detailResponse.data, '空间详情 data');
        const expectedTypeId = filters.type === 'seminar' ? '6' : '2';
        const actualTypeId = asString(detail.type_id);
        if (actualTypeId && actualTypeId !== expectedTypeId) {
          notices.push(`${fallbackName} 的空间类型与当前标签不一致，已跳过。`);
          continue;
        }
        const topId = asString(detail.topId || area.topId);
        const parentId = asString(detail.parentId || area.parentId);
        const effectiveBuildingId = asString(
          detail.topId
          || detail.parentId
          || area.topId
          || area.parentId
          || MAIN_LIBRARY_ID,
        );
        const availabilityResponse = await this.apiService.fetchSeminarAvailability({
          room: areaId,
          area: effectiveBuildingId,
        });
        const availabilityData = requireRecord(availabilityResponse.data, '空间时段 data');
        const availabilityList = requireArray(availabilityData.list, '空间时段 data.list');
        const dateEntry = availabilityList
          .map(asRecord)
          .find((item) => asString(item.date) === filters.date);
        const availabilityInfo = dateEntry
          ? requireRecord(dateEntry.info, '空间时段 date.info')
          : {};
        const name = asString(detail.nameMerge || fallbackName);
        const { floor, location } = parseLocation(name);
        const openStartTime = formatApiTime(availabilityInfo.startTime);
        const openEndTime = formatApiTime(availabilityInfo.endTime);
        const blockedIntervals = parseBlockedIntervals(availabilityInfo.list);
        const fullyBooked = isEnabled(availabilityInfo.Fully_Booked)
          || isEnabled(detail.Fully_Booked)
          || isEnabled(area.Fully_Booked);
        const minDurationMinutes = asNumber(availabilityInfo.minTime);
        const maxDurationMinutes = asNumber(availabilityInfo.maxTime);
        const timeMatches = requestedSpaceTimeIsAvailable(
          filters,
          openStartTime,
          openEndTime,
          blockedIntervals,
          minDurationMinutes,
          maxDurationMinutes,
        );
        const available = Boolean(dateEntry) && Boolean(openStartTime) && !fullyBooked && timeMatches;
        const spaceType = filters.type === 'seminar' ? 'seminar' : 'singleStudy';

        candidates.push({
          key: `${spaceType}:${areaId}`,
          kind: 'space',
          type: spaceType,
          queryDate: filters.date,
          targetId: areaId,
          name,
          location,
          floor,
          available,
          statusLabel: fullyBooked
            ? '已约满'
            : !dateEntry || !openStartTime
              ? '当日不可预约'
              : timeMatches ? '可预约' : '目标时间不可用',
          parentId,
          topId,
          openStartTime,
          openEndTime,
          blockedIntervals,
          minDurationMinutes,
          maxDurationMinutes,
          minPersons: asNumber(availabilityInfo.minPerson || detail.minPerson),
          maxPersons: asNumber(availabilityInfo.maxPerson || detail.maxPerson),
          readonlyTitle: isEnabled(detail.readonlyTitle),
          titleOptions: parseTitleOptions(detail.title),
        });
      } catch (error) {
        if (error instanceof FatalQueryError || error instanceof ResponseShapeError) throw error;
        notices.push(`${fallbackName} 查询失败：${getErrorMessage(error)}`);
      }
    }

    return candidates;
  }
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function requireRecord(value: unknown, fieldName: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ResponseShapeError(`${fieldName} 的响应结构不符合预期。`);
  }
  return value as UnknownRecord;
}

function requireArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ResponseShapeError(`${fieldName} 的响应结构不符合预期。`);
  }
  return value;
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asNumber(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function isEnabled(value: unknown): boolean {
  return value === true || Number(value) === 1 || ['true', 'yes'].includes(asString(value).toLowerCase());
}

function isTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours = -1, minutes = -1] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function minutesFromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value: number): string {
  const normalizedValue = Math.max(0, Math.min(1_439, Math.round(value)));
  const hours = Math.floor(normalizedValue / 60);
  const minutes = normalizedValue % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatApiTime(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const textValue = asString(value);
  if (isTime(textValue)) return textValue;
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 1_439) {
    return timeFromMinutes(numericValue);
  }
  throw new ResponseShapeError(`接口返回了无效时间：${textValue}`);
}

function parseLocation(name: string): { floor: string; location: string } {
  const nameParts = name.split('-').filter(Boolean);
  const floor = normalizeFloorLabel(nameParts[1] || name);
  return {
    floor,
    location: [nameParts[0] || '主馆', floor].filter(Boolean).join(' · '),
  };
}

function normalizeFloorLabel(value: string): string {
  const floorPatterns: Array<{ label: string; pattern: RegExp }> = [
    { label: '二层', pattern: /二[层楼]|2\s*F/i },
    { label: '三层', pattern: /三[层楼]|3\s*F/i },
    { label: '四层', pattern: /四[层楼]|4\s*F/i },
    { label: '五层', pattern: /五[层楼]|5\s*F/i },
    { label: '六层', pattern: /六[层楼]|6\s*F/i },
  ];
  return floorPatterns.find(({ pattern }) => pattern.test(value))?.label || value;
}

function matchesFloor(area: UnknownRecord, floor: string | undefined): boolean {
  if (!floor) return true;
  const areaName = asString(area.nameMerge || area.name);
  return parseLocation(areaName).floor === floor;
}

function matchesName(candidateName: string, nameFilter: string | undefined): boolean {
  if (!nameFilter) return true;
  return candidateName.toLocaleLowerCase().includes(nameFilter.toLocaleLowerCase());
}

function segmentContainsRequestedTime(segment: UnknownRecord, filters: QueryFilters): boolean {
  if (!filters.startTime || !filters.endTime) return true;
  const segmentStartTime = asString(segment.start);
  const segmentEndTime = asString(segment.end);
  if (!isTime(segmentStartTime) || !isTime(segmentEndTime)) {
    throw new ResponseShapeError('可用座位时间段包含无效时间。');
  }
  if (minutesFromTime(filters.startTime) >= minutesFromTime(filters.endTime)) return false;
  return minutesFromTime(segmentStartTime) <= minutesFromTime(filters.startTime)
    && minutesFromTime(segmentEndTime) >= minutesFromTime(filters.endTime);
}

function parseBlockedIntervals(value: unknown): BlockedInterval[] {
  if (value === null || value === undefined) return [];
  return requireArray(value, '空间时段 date.info.list').map((item, index) => {
    const interval = requireRecord(item, `空间占用区间 ${index + 1}`);
    const startTime = formatApiTime(interval.beginNum ?? interval.startTime ?? interval.start);
    const endTime = formatApiTime(interval.endNum ?? interval.endTime ?? interval.end);
    if (!isTime(startTime) || !isTime(endTime) || minutesFromTime(startTime) >= minutesFromTime(endTime)) {
      throw new ResponseShapeError(`空间占用区间 ${index + 1} 的时间无效。`);
    }
    return { startTime, endTime };
  });
}

function parseTitleOptions(value: unknown): TitleOption[] {
  return asArray(value).map(asRecord).map((titleOption) => ({
    id: asString(titleOption.id),
    title: asString(titleOption.title || titleOption.name),
  })).filter((titleOption) => titleOption.id && titleOption.title);
}

function requestedSpaceTimeIsAvailable(
  filters: QueryFilters,
  openStartTime: string,
  openEndTime: string,
  blockedIntervals: BlockedInterval[],
  minDurationMinutes: number,
  maxDurationMinutes: number,
): boolean {
  if (!filters.startTime || !filters.endTime) return true;
  if (!isTime(openStartTime) || !isTime(openEndTime)) return false;

  const requestedStart = minutesFromTime(filters.startTime);
  const requestedEnd = minutesFromTime(filters.endTime);
  const requestedDuration = requestedEnd - requestedStart;
  if (requestedDuration <= 0) return false;
  if (requestedStart < minutesFromTime(openStartTime)) return false;
  if (requestedEnd > minutesFromTime(openEndTime)) return false;
  if (minDurationMinutes > 0 && requestedDuration < minDurationMinutes) return false;
  if (maxDurationMinutes > 0 && requestedDuration > maxDurationMinutes) return false;

  return !blockedIntervals.some((interval) => (
    requestedStart < minutesFromTime(interval.endTime)
    && requestedEnd > minutesFromTime(interval.startTime)
  ));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

class ResponseShapeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResponseShapeError';
  }
}
