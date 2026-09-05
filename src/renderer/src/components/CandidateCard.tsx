import { Clock3, Heart, MapPin, Star, Users } from 'lucide-react';

import type { BookingCandidate } from '../../../shared/contracts';
import { AvailabilityTimeline } from './AvailabilityTimeline';

interface CandidateCardProps {
  candidate: BookingCandidate;
  selected: boolean;
  favorite: boolean;
  recommended: boolean;
  selectedStartTime?: string;
  selectedEndTime?: string;
  onSelect(): void;
  onToggleFavorite(): void;
}

export function CandidateCard({
  candidate,
  selected,
  favorite,
  recommended,
  selectedStartTime,
  selectedEndTime,
  onSelect,
  onToggleFavorite,
}: CandidateCardProps) {
  return (
    <article className={`candidate-card${selected ? ' candidate-selected' : ''}`}>
      <div className="candidate-heading">
        <div>
          <div className="candidate-title-row">
            <h3>{candidate.name}</h3>
            {recommended && (
              <span className="recommendation-badge"><Star size={13} fill="currentColor" /> 推荐</span>
            )}
          </div>
          <p><MapPin size={14} /> {candidate.location || '主馆'}</p>
        </div>
        <button
          className={`icon-button${favorite ? ' favorite-active' : ''}`}
          onClick={onToggleFavorite}
          title={favorite ? '取消收藏' : '加入收藏'}
          type="button"
        >
          <Heart size={19} fill={favorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className="candidate-meta">
        <span className={candidate.available ? 'status-available' : 'status-unavailable'}>
          {candidate.statusLabel}
        </span>
        {candidate.kind === 'seat' ? (
          <span><Clock3 size={14} /> {candidate.actualStartTime}-{candidate.actualEndTime}</span>
        ) : (
          <>
            <span><Clock3 size={14} /> {candidate.openStartTime || '--:--'}-{candidate.openEndTime || '--:--'}</span>
            {(candidate.minPersons > 0 || candidate.maxPersons > 0) && (
              <span><Users size={14} /> {formatPersonRange(candidate.minPersons, candidate.maxPersons)}</span>
            )}
          </>
        )}
      </div>

      <AvailabilityTimeline
        candidate={candidate}
        selectedStartTime={selectedStartTime}
        selectedEndTime={selectedEndTime}
      />

      <div className="candidate-footer">
        <div className="candidate-note">
          {candidate.kind === 'space' && candidate.minDurationMinutes > 0
            ? `最短 ${candidate.minDurationMinutes} 分钟${candidate.maxDurationMinutes > 0 ? ` · 最长 ${candidate.maxDurationMinutes} 分钟` : ''}`
            : candidate.kind === 'seat' ? `区域：${candidate.areaName}` : '请查看开放时间和占用区间'}
        </div>
        <button
          className={selected ? 'secondary-button' : 'primary-button'}
          disabled={!candidate.available}
          onClick={onSelect}
          type="button"
        >
          {selected ? '已选择' : '选择候选'}
        </button>
      </div>
    </article>
  );
}

function formatPersonRange(minimumPersons: number, maximumPersons: number): string {
  if (minimumPersons > 0 && maximumPersons > 0) return `${minimumPersons}-${maximumPersons} 人`;
  if (minimumPersons > 0) return `至少 ${minimumPersons} 人`;
  return `最多 ${maximumPersons} 人`;
}
