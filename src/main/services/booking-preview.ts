import type { BookingPreview, PreviewInput } from '../../shared/contracts';

const TYPE_LABELS = {
  seat: '普通座位',
  singleStudy: '单人研习间',
  seminar: '多人研讨间',
} as const;

export class BookingPreviewService {
  public create(input: PreviewInput): BookingPreview {
    if (!input.candidate.available) {
      throw new Error('当前候选不可预约，请重新查询或选择其他候选。');
    }
    if (input.candidate.queryDate !== input.date) {
      throw new Error('日期已经改变，请按新日期重新查询后再生成预览。');
    }

    if (input.candidate.kind === 'seat') {
      return {
        typeLabel: TYPE_LABELS.seat,
        candidateName: input.candidate.name,
        location: input.candidate.location,
        date: input.date,
        timeRange: `${input.candidate.actualStartTime}-${input.candidate.actualEndTime}`,
        warnings: [
          '普通座位按系统时间段预约，预览显示的是最终实际时段。',
          '桌面版第一阶段仅提供预览，不会发送预约请求。',
        ],
        submissionEnabled: false,
      };
    }

    const startTime = input.startTime || '';
    const endTime = input.endTime || '';
    if (!isValidTimeRange(startTime, endTime)) {
      throw new Error('请选择有效的开始时间和结束时间。');
    }
    assertSpaceTimeAvailable(input.candidate, startTime, endTime);
    if (!input.title || !input.content || !input.mobile) {
      throw new Error('空间预约预览需要填写标题、用途和手机号。');
    }
    if (input.candidate.readonlyTitle) {
      const titleMatchesPreset = input.candidate.titleOptions.some(
        (titleOption) => titleOption.title === input.title,
      );
      if (!titleMatchesPreset) throw new Error('该空间要求从预设标题中选择申请标题。');
    }

    const teamUserIds = [...new Set(input.teamUserIds || [])];
    const participantCount = input.candidate.type === 'seminar' ? teamUserIds.length + 1 : 1;
    if (
      input.candidate.type === 'seminar'
      && input.candidate.minPersons > 0
      && participantCount < input.candidate.minPersons
    ) {
      throw new Error(`该研讨间至少需要 ${input.candidate.minPersons} 人。`);
    }
    if (
      input.candidate.type === 'seminar'
      && input.candidate.maxPersons > 0
      && participantCount > input.candidate.maxPersons
    ) {
      throw new Error(`该研讨间最多容纳 ${input.candidate.maxPersons} 人。`);
    }

    return {
      typeLabel: TYPE_LABELS[input.candidate.type],
      candidateName: input.candidate.name,
      location: input.candidate.location,
      date: input.date,
      timeRange: `${startTime}-${endTime}`,
      title: input.title,
      content: input.content,
      maskedMobile: maskMobile(input.mobile),
      participantCount,
      warnings: ['桌面版第一阶段仅提供预览，不会发送预约请求。'],
      submissionEnabled: false,
    };
  }
}

function isValidTimeRange(startTime: string, endTime: string): boolean {
  if (!isValidTime(startTime) || !isValidTime(endTime)) return false;
  return minutesFromTime(startTime) < minutesFromTime(endTime);
}

function assertSpaceTimeAvailable(
  candidate: Extract<PreviewInput['candidate'], { kind: 'space' }>,
  startTime: string,
  endTime: string,
): void {
  const startMinutes = minutesFromTime(startTime);
  const endMinutes = minutesFromTime(endTime);
  const durationMinutes = endMinutes - startMinutes;
  if (
    startMinutes < minutesFromTime(candidate.openStartTime)
    || endMinutes > minutesFromTime(candidate.openEndTime)
  ) {
    throw new Error(`预约时间必须位于 ${candidate.openStartTime}-${candidate.openEndTime} 之内。`);
  }
  if (candidate.minDurationMinutes > 0 && durationMinutes < candidate.minDurationMinutes) {
    throw new Error(`预约时长不能少于 ${candidate.minDurationMinutes} 分钟。`);
  }
  if (candidate.maxDurationMinutes > 0 && durationMinutes > candidate.maxDurationMinutes) {
    throw new Error(`预约时长不能超过 ${candidate.maxDurationMinutes} 分钟。`);
  }
  const overlapsBlockedInterval = candidate.blockedIntervals.some((interval) => (
    startMinutes < minutesFromTime(interval.endTime)
    && endMinutes > minutesFromTime(interval.startTime)
  ));
  if (overlapsBlockedInterval) throw new Error('预约时间与已占用时段冲突，请重新选择。');
}

function isValidTime(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function minutesFromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function maskMobile(mobile: string): string {
  return mobile.length >= 7
    ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}`
    : '***';
}
