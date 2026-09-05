import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Heart,
  Library,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  BookingCandidate,
  BookingPreview,
  Favorite,
  FavoriteInput,
  LoginStatus,
  QueryResponse,
  ReservationType,
} from '../../shared/contracts';
import { CandidateCard } from './components/CandidateCard';
import { PreviewModal } from './components/PreviewModal';

const MAIN_LIBRARY_ID = '53';
const RESULT_PAGE_SIZE = 30;
const REFRESH_COOLDOWN_SECONDS = 3;

const TYPE_OPTIONS: Array<{
  value: ReservationType;
  label: string;
  description: string;
}> = [
  { value: 'seat', label: '普通座位', description: '按区域和系统时段查询' },
  { value: 'singleStudy', label: '单人研习间', description: '适合个人安静学习' },
  { value: 'seminar', label: '多人研讨间', description: '按人数和时间筛选' },
];

const FLOOR_OPTIONS = ['', '二层', '三层', '四层', '五层', '六层'];

export function App() {
  const [loginStatus, setLoginStatus] = useState<LoginStatus>({
    state: 'checking',
    message: '正在检查登录会话',
  });
  const [reservationType, setReservationType] = useState<ReservationType>('seat');
  const [bookingDate, setBookingDate] = useState(getRelativeDate(1));
  const [startTime, setStartTime] = useState('08:30');
  const [endTime, setEndTime] = useState('10:00');
  const [floor, setFloor] = useState('');
  const [areaId, setAreaId] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [onlyAvailable, setOnlyAvailable] = useState(true);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<BookingCandidate | null>(null);
  const [visibleResultCount, setVisibleResultCount] = useState(RESULT_PAGE_SIZE);
  const [refreshCooldown, setRefreshCooldown] = useState(0);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [mobile, setMobile] = useState('');
  const [teamUserText, setTeamUserText] = useState('');
  const [preview, setPreview] = useState<BookingPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const currentFilterSignature = JSON.stringify({
    reservationType,
    bookingDate,
    startTime,
    endTime,
    floor,
    areaId,
    nameFilter,
  });
  const latestFilterSignatureRef = useRef(currentFilterSignature);

  useEffect(() => {
    let disposed = false;
    void window.bookingDesktop.getLoginStatus()
      .then((status) => {
        if (!disposed) setLoginStatus(status);
      })
      .catch((error: unknown) => {
        if (!disposed) setErrorMessage(getErrorMessage(error));
      });
    void window.bookingDesktop.listFavorites()
      .then((favoriteItems) => {
        if (!disposed) setFavorites(favoriteItems);
      })
      .catch((error: unknown) => {
        if (!disposed) setErrorMessage(getErrorMessage(error));
      });
    const unsubscribe = window.bookingDesktop.onLoginStatusChanged((status) => {
      if (!disposed) setLoginStatus(status);
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    latestFilterSignatureRef.current = currentFilterSignature;
    setQueryResult(null);
    setSelectedCandidate(null);
    setPreview(null);
    setVisibleResultCount(RESULT_PAGE_SIZE);
  }, [currentFilterSignature]);

  useEffect(() => {
    if (refreshCooldown <= 0) return undefined;
    const countdownTimer = window.setInterval(() => {
      setRefreshCooldown((currentValue) => Math.max(0, currentValue - 1));
    }, 1_000);
    return () => window.clearInterval(countdownTimer);
  }, [refreshCooldown]);

  const favoritePriorityByTarget = useMemo(() => new Map(
    favorites.map((favoriteItem) => [
      `${favoriteItem.type}:${favoriteItem.targetId}`,
      favoriteItem.priority,
    ]),
  ), [favorites]);

  const sortedCandidates = useMemo(() => {
    const candidates = [...(queryResult?.candidates || [])];
    return candidates.sort((firstCandidate, secondCandidate) => {
      const firstFavoritePriority = favoritePriorityByTarget.get(
        `${firstCandidate.type}:${firstCandidate.targetId}`,
      );
      const secondFavoritePriority = favoritePriorityByTarget.get(
        `${secondCandidate.type}:${secondCandidate.targetId}`,
      );
      if (firstFavoritePriority !== undefined || secondFavoritePriority !== undefined) {
        if (firstFavoritePriority === undefined) return 1;
        if (secondFavoritePriority === undefined) return -1;
        if (firstFavoritePriority !== secondFavoritePriority) {
          return firstFavoritePriority - secondFavoritePriority;
        }
      }
      if (firstCandidate.available !== secondCandidate.available) {
        return firstCandidate.available ? -1 : 1;
      }
      return firstCandidate.name.localeCompare(secondCandidate.name, 'zh-CN', { numeric: true });
    });
  }, [favoritePriorityByTarget, queryResult]);

  const filteredCandidates = useMemo(() => sortedCandidates.filter((candidate) => {
    if (onlyAvailable && !candidate.available) return false;
    if (
      onlyFavorites
      && !favoritePriorityByTarget.has(`${candidate.type}:${candidate.targetId}`)
    ) return false;
    return true;
  }), [favoritePriorityByTarget, onlyAvailable, onlyFavorites, sortedCandidates]);

  const recommendedCandidate = filteredCandidates.find((candidate) => candidate.available) || null;
  const displayedCandidates = filteredCandidates.slice(0, visibleResultCount);
  const currentTypeFavorites = favorites.filter((favorite) => favorite.type === reservationType);
  const lastQueryTime = queryResult
    ? new Date(queryResult.queriedAt).toLocaleTimeString('zh-CN', { hour12: false })
    : '尚未查询';

  async function openLoginWindow() {
    setErrorMessage('');
    try {
      const status = await window.bookingDesktop.openLoginWindow();
      setLoginStatus(status);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function changeReservationType(nextType: ReservationType) {
    setReservationType(nextType);
    setQueryResult(null);
    setSelectedCandidate(null);
    setAreaId('');
    setNameFilter('');
    setFloor('');
    setErrorMessage('');
  }

  async function queryAvailability() {
    if (loginStatus.state !== 'authenticated') {
      setErrorMessage('请先登录，再查询空间。');
      return;
    }
    if (refreshCooldown > 0 || isQuerying) return;

    setErrorMessage('');
    setIsQuerying(true);
    setSelectedCandidate(null);
    setVisibleResultCount(RESULT_PAGE_SIZE);
    const requestedFilterSignature = currentFilterSignature;
    try {
      const result = await window.bookingDesktop.queryAvailability({
        type: reservationType,
        date: bookingDate,
        premisesId: MAIN_LIBRARY_ID,
        areaId: areaId.trim() || undefined,
        name: nameFilter.trim() || undefined,
        floor: floor || undefined,
        startTime,
        endTime,
      });
      if (latestFilterSignatureRef.current === requestedFilterSignature) {
        setQueryResult(result);
      } else {
        setErrorMessage('查询期间条件发生了变化，请按新条件重新查询。');
      }
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsQuerying(false);
      setRefreshCooldown(REFRESH_COOLDOWN_SECONDS);
    }
  }

  function selectCandidate(candidate: BookingCandidate) {
    setSelectedCandidate(candidate);
    setErrorMessage('');
    if (candidate.kind === 'space' && candidate.readonlyTitle && candidate.titleOptions[0]) {
      setTitle(candidate.titleOptions[0].title);
    }
  }

  async function toggleFavorite(candidate: BookingCandidate) {
    setErrorMessage('');
    const existingFavorite = favorites.find((favorite) => (
      favorite.type === candidate.type && favorite.targetId === candidate.targetId
    ));
    try {
      const nextFavorites = existingFavorite
        ? await window.bookingDesktop.removeFavorite(existingFavorite.id)
        : await window.bookingDesktop.saveFavorite(createFavoriteInput(candidate));
      setFavorites(nextFavorites);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function moveFavorite(favoriteId: string, direction: 'up' | 'down') {
    try {
      setFavorites(await window.bookingDesktop.moveFavorite(favoriteId, direction));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  async function removeFavorite(favoriteId: string) {
    try {
      setFavorites(await window.bookingDesktop.removeFavorite(favoriteId));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  function applyFavorite(favorite: Favorite) {
    changeReservationType(favorite.type);
    setAreaId(favorite.areaId || (favorite.type === 'seat' ? '' : favorite.targetId));
    setNameFilter(favorite.type === 'seat' ? favorite.name : '');
    setFloor(favorite.floor);
  }

  async function createBookingPreview() {
    if (!selectedCandidate) return;
    setErrorMessage('');
    try {
      const nextPreview = await window.bookingDesktop.createPreview({
        candidate: selectedCandidate,
        date: bookingDate,
        startTime,
        endTime,
        title: title.trim() || undefined,
        content: content.trim() || undefined,
        mobile: mobile.trim() || undefined,
        teamUserIds: parseTeamUserIds(teamUserText),
      });
      setPreview(nextPreview);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    }
  }

  return (
    <div className="application-shell">
      <header className="top-bar">
        <div className="brand-block">
          <div className="brand-icon"><Library size={24} /></div>
          <div>
            <h1>ZJU Library Booker</h1>
            <p>主馆空间查询与预约预览</p>
          </div>
          <span className="read-only-badge"><ShieldCheck size={14} /> 只读验证版</span>
        </div>
        <div className="header-actions">
          <div className="query-time">
            <span>上次查询</span>
            <strong>{lastQueryTime}</strong>
          </div>
          <div className={`login-status login-${loginStatus.state}`}>
            <span className="status-dot" />
            <div><strong>{getLoginStateLabel(loginStatus.state)}</strong><small>{loginStatus.message}</small></div>
          </div>
          <button className="login-button" onClick={() => void openLoginWindow()} type="button">
            <LogIn size={17} /> {loginStatus.state === 'authenticated' ? '打开登录窗口' : '登录'}
          </button>
        </div>
      </header>

      <nav className="type-tabs" aria-label="预约类型">
        {TYPE_OPTIONS.map((typeOption) => (
          <button
            className={reservationType === typeOption.value ? 'type-tab type-tab-active' : 'type-tab'}
            key={typeOption.value}
            onClick={() => changeReservationType(typeOption.value)}
            type="button"
          >
            {typeOption.value === 'seminar' ? <Users size={19} /> : <BookOpen size={19} />}
            <span><strong>{typeOption.label}</strong><small>{typeOption.description}</small></span>
          </button>
        ))}
      </nav>

      {errorMessage && <div className="error-banner">{errorMessage}</div>}

      <main className="workspace">
        <aside className="filter-panel panel-card">
          <div className="panel-title"><SlidersHorizontal size={18} /><h2>预约条件</h2></div>

          <div className="field-group">
            <label>预约日期</label>
            <div className="date-shortcuts">
              <button
                className={bookingDate === getRelativeDate(0) ? 'shortcut-active' : ''}
                onClick={() => setBookingDate(getRelativeDate(0))}
                type="button"
              >今天</button>
              <button
                className={bookingDate === getRelativeDate(1) ? 'shortcut-active' : ''}
                onClick={() => setBookingDate(getRelativeDate(1))}
                type="button"
              >明天</button>
            </div>
            <div className="input-with-icon"><CalendarDays size={16} /><input type="date" value={bookingDate} onChange={(event) => setBookingDate(event.target.value)} /></div>
          </div>

          <div className="field-group">
            <label>{reservationType === 'seat' ? '希望覆盖的时间' : '预约时间'}</label>
            <div className="time-row">
              <div className="input-with-icon"><Clock3 size={16} /><input type="time" step="300" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></div>
              <span>至</span>
              <div className="input-with-icon"><Clock3 size={16} /><input type="time" step="300" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></div>
            </div>
            {reservationType === 'seat' && <small className="field-help">仅用于筛选；最终预约时间以系统时段为准。</small>}
          </div>

          <div className="field-group">
            <label htmlFor="floor-filter">楼层</label>
            <select id="floor-filter" value={floor} onChange={(event) => setFloor(event.target.value)}>
              {FLOOR_OPTIONS.map((floorOption) => (
                <option key={floorOption || 'all'} value={floorOption}>{floorOption || '全部楼层'}</option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label htmlFor="area-filter">{reservationType === 'seat' ? '区域 ID（可选）' : '空间 ID（可选）'}</label>
            <input id="area-filter" placeholder={reservationType === 'seat' ? '例如 58' : '例如 125'} value={areaId} onChange={(event) => setAreaId(event.target.value)} />
          </div>

          <div className="field-group">
            <label htmlFor="name-filter">名称</label>
            <div className="input-with-icon"><Search size={16} /><input id="name-filter" placeholder={reservationType === 'seat' ? '座位号，如 Z2F001' : '空间名称，如 5SC01'} value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} /></div>
          </div>

          <div className="toggle-list">
            <label><input checked={onlyAvailable} onChange={(event) => setOnlyAvailable(event.target.checked)} type="checkbox" /><span>只看当前可预约</span></label>
            <label><input checked={onlyFavorites} onChange={(event) => setOnlyFavorites(event.target.checked)} type="checkbox" /><span>只看收藏候选</span></label>
          </div>

          <button
            className="query-button"
            disabled={isQuerying || refreshCooldown > 0}
            onClick={() => void queryAvailability()}
            type="button"
          >
            {isQuerying ? <LoaderCircle className="spin" size={18} /> : <RefreshCw size={18} />}
            {isQuerying
              ? '正在查询可用空间'
              : refreshCooldown > 0 ? `${refreshCooldown} 秒后可刷新` : '查询可用空间'}
          </button>

          <section className="favorites-section">
            <div className="subsection-title"><Heart size={16} /><h3>常用收藏</h3><span>{currentTypeFavorites.length}</span></div>
            {currentTypeFavorites.length === 0 ? (
              <p className="empty-small">查询后点击候选卡片右上角的爱心即可收藏。</p>
            ) : currentTypeFavorites.map((favorite, index) => (
              <div className="favorite-row" key={favorite.id}>
                <button className="favorite-main" onClick={() => applyFavorite(favorite)} type="button">
                  <strong>{favorite.name}</strong><small>{favorite.location}</small>
                </button>
                <div className="favorite-controls">
                  <button disabled={index === 0} onClick={() => void moveFavorite(favorite.id, 'up')} title="上移" type="button"><ArrowUp size={14} /></button>
                  <button disabled={index === currentTypeFavorites.length - 1} onClick={() => void moveFavorite(favorite.id, 'down')} title="下移" type="button"><ArrowDown size={14} /></button>
                  <button onClick={() => void removeFavorite(favorite.id)} title="删除" type="button"><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
          </section>
        </aside>

        <section className="results-panel">
          <div className="results-heading">
            <div>
              <p className="eyebrow"><Sparkles size={14} /> 收藏顺序优先推荐</p>
              <h2>{TYPE_OPTIONS.find((option) => option.value === reservationType)?.label}候选</h2>
              <p>{queryResult ? `找到 ${filteredCandidates.length} 个符合当前显示条件的候选` : '设置条件后查询主馆可用资源'}</p>
            </div>
            {queryResult && <span className="result-date">{queryResult.filters.date}</span>}
          </div>

          {queryResult?.notices.length ? (
            <details className="notices-block">
              <summary>查询提示（{queryResult.notices.length}）</summary>
              {queryResult.notices.map((notice) => <p key={notice}>{notice}</p>)}
            </details>
          ) : null}

          {!queryResult ? (
            <div className="empty-state"><div className="empty-icon"><Search size={30} /></div><h3>等待查询</h3><p>登录后选择日期和时间，点击“查询可用空间”。</p></div>
          ) : displayedCandidates.length === 0 ? (
            <div className="empty-state"><div className="empty-icon"><CalendarDays size={30} /></div><h3>没有匹配候选</h3><p>可以尝试关闭“只看当前可预约”，或调整楼层和时间。</p></div>
          ) : (
            <div className={reservationType === 'seat' ? 'candidate-grid seat-grid' : 'candidate-grid'}>
              {displayedCandidates.map((candidate) => (
                <CandidateCard
                  candidate={candidate}
                  favorite={favoritePriorityByTarget.has(`${candidate.type}:${candidate.targetId}`)}
                  key={candidate.key}
                  onSelect={() => selectCandidate(candidate)}
                  onToggleFavorite={() => void toggleFavorite(candidate)}
                  recommended={candidate.key === recommendedCandidate?.key}
                  selected={candidate.key === selectedCandidate?.key}
                  selectedEndTime={endTime}
                  selectedStartTime={startTime}
                />
              ))}
            </div>
          )}
          {displayedCandidates.length < filteredCandidates.length && (
            <button className="load-more-button" onClick={() => setVisibleResultCount((count) => count + RESULT_PAGE_SIZE)} type="button">
              显示更多候选（剩余 {filteredCandidates.length - displayedCandidates.length}）
            </button>
          )}
        </section>

        <aside className="booking-panel panel-card">
          <div className="panel-title"><Check size={18} /><h2>本次预约</h2></div>
          {!selectedCandidate ? (
            <div className="selection-placeholder"><ChevronRight size={28} /><h3>尚未选择候选</h3><p>从中间列表选择一个可预约空间或座位。</p></div>
          ) : (
            <>
              <div className="selected-summary">
                <span>{getTypeLabel(selectedCandidate.type)}</span>
                <h3>{selectedCandidate.name}</h3>
                <p>{selectedCandidate.location}</p>
                <dl>
                  <div><dt>日期</dt><dd>{selectedCandidate.queryDate}</dd></div>
                  <div><dt>实际时间</dt><dd>{selectedCandidate.kind === 'seat' ? `${selectedCandidate.actualStartTime}-${selectedCandidate.actualEndTime}` : `${startTime}-${endTime}`}</dd></div>
                  {selectedCandidate.kind === 'seat' && <div><dt>系统时段</dt><dd>{selectedCandidate.segmentId}</dd></div>}
                </dl>
              </div>

              {selectedCandidate.kind === 'space' && (
                <div className="booking-form">
                  <div className="field-group">
                    <label htmlFor="booking-title">申请标题</label>
                    {selectedCandidate.readonlyTitle ? (
                      <select id="booking-title" value={title} onChange={(event) => setTitle(event.target.value)}>
                        <option value="">请选择预设标题</option>
                        {selectedCandidate.titleOptions.map((titleOption) => (
                          <option key={titleOption.id} value={titleOption.title}>{titleOption.title}</option>
                        ))}
                      </select>
                    ) : (
                      <input id="booking-title" placeholder="例如：课程学习" value={title} onChange={(event) => setTitle(event.target.value)} />
                    )}
                  </div>
                  <div className="field-group">
                    <label htmlFor="booking-content">申请用途</label>
                    <textarea id="booking-content" placeholder="简要说明本次使用目的" rows={3} value={content} onChange={(event) => setContent(event.target.value)} />
                  </div>
                  <div className="field-group">
                    <label htmlFor="booking-mobile">联系电话</label>
                    <input id="booking-mobile" inputMode="tel" placeholder="仅用于本次预览，不保存" value={mobile} onChange={(event) => setMobile(event.target.value)} />
                  </div>
                  {selectedCandidate.type === 'seminar' && (
                    <div className="field-group">
                      <label htmlFor="team-users">额外参与人 ID</label>
                      <textarea id="team-users" placeholder="使用逗号分隔，例如 101,102" rows={2} value={teamUserText} onChange={(event) => setTeamUserText(event.target.value)} />
                      <small className="field-help">提交账号计 1 人；当前共 {parseTeamUserIds(teamUserText).length + 1} 人。</small>
                    </div>
                  )}
                </div>
              )}

              <div className="privacy-note"><ShieldCheck size={16} /><span>手机号、用途和参与人不会写入收藏文件。</span></div>
              <button className="preview-button" disabled={!selectedCandidate.available} onClick={() => void createBookingPreview()} type="button">
                生成预约预览
              </button>
              <button className="disabled-submit-button full-width" disabled type="button">确认提交（后续阶段）</button>
              <p className="phase-note">第一阶段没有注册预约确认接口，当前无法产生真实预约。</p>
            </>
          )}
        </aside>
      </main>

      {preview && <PreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function createFavoriteInput(candidate: BookingCandidate): FavoriteInput {
  return {
    type: candidate.type,
    targetId: candidate.targetId,
    name: candidate.name,
    location: candidate.location,
    floor: candidate.floor,
    areaId: candidate.kind === 'seat' ? candidate.areaId : undefined,
  };
}

function parseTeamUserIds(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

function getRelativeDate(dayOffset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLoginStateLabel(state: LoginStatus['state']): string {
  if (state === 'authenticated') return '已登录';
  if (state === 'authenticating') return '登录中';
  if (state === 'checking') return '检查中';
  if (state === 'error') return '连接异常';
  return '未登录';
}

function getTypeLabel(type: ReservationType): string {
  return TYPE_OPTIONS.find((typeOption) => typeOption.value === type)?.label || type;
}

function getErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return '操作失败，请稍后重试。';
  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
}
