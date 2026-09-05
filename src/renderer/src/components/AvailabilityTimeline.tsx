import type { BlockedInterval, BookingCandidate } from '../../../shared/contracts';

interface AvailabilityTimelineProps {
  candidate: BookingCandidate;
  selectedStartTime?: string;
  selectedEndTime?: string;
}

interface TimelineSegment {
  className: string;
  left: number;
  width: number;
  label: string;
}

export function AvailabilityTimeline({
  candidate,
  selectedStartTime,
  selectedEndTime,
}: AvailabilityTimelineProps) {
  if (candidate.kind === 'seat') {
    return (
      <div className="timeline-block">
        <div className="timeline-labels">
          <span>{candidate.actualStartTime}</span>
          <span>系统实际预约时段</span>
          <span>{candidate.actualEndTime}</span>
        </div>
        <div className="timeline-track" aria-label="普通座位实际预约时段">
          <div className="timeline-segment timeline-available" style={{ left: '0%', width: '100%' }} />
        </div>
      </div>
    );
  }

  if (!candidate.openStartTime || !candidate.openEndTime) {
    return <div className="timeline-empty">当日没有可展示的开放时段</div>;
  }

  const startMinutes = minutesFromTime(candidate.openStartTime);
  const endMinutes = minutesFromTime(candidate.openEndTime);
  const totalMinutes = Math.max(1, endMinutes - startMinutes);
  const segments: TimelineSegment[] = candidate.blockedIntervals.map((interval) => (
    createSegment(interval, startMinutes, totalMinutes, 'timeline-blocked', '已占用')
  ));

  if (selectedStartTime && selectedEndTime) {
    segments.push(createSegment(
      { startTime: selectedStartTime, endTime: selectedEndTime },
      startMinutes,
      totalMinutes,
      'timeline-selected',
      '当前选择',
    ));
  }

  return (
    <div className="timeline-block">
      <div className="timeline-labels">
        <span>{candidate.openStartTime}</span>
        <span>可预约时间轴</span>
        <span>{candidate.openEndTime}</span>
      </div>
      <div className="timeline-track" aria-label="空间可预约时间轴">
        <div className="timeline-segment timeline-available" style={{ left: '0%', width: '100%' }} />
        {segments.map((segment, index) => (
          <div
            className={`timeline-segment ${segment.className}`}
            key={`${segment.className}-${index}`}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            title={segment.label}
          />
        ))}
      </div>
    </div>
  );
}

function createSegment(
  interval: BlockedInterval,
  timelineStartMinutes: number,
  timelineDurationMinutes: number,
  className: string,
  label: string,
): TimelineSegment {
  const intervalStart = Math.max(timelineStartMinutes, minutesFromTime(interval.startTime));
  const intervalEnd = Math.min(
    timelineStartMinutes + timelineDurationMinutes,
    minutesFromTime(interval.endTime),
  );
  const left = ((intervalStart - timelineStartMinutes) / timelineDurationMinutes) * 100;
  const width = Math.max(0, ((intervalEnd - intervalStart) / timelineDurationMinutes) * 100);
  return { className, left, width, label };
}

function minutesFromTime(value: string): number {
  const [hours = 0, minutes = 0] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
