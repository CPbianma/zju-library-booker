export type ReservationType = 'seat' | 'singleStudy' | 'seminar';

export type LoginState = 'checking' | 'unauthenticated' | 'authenticating' | 'authenticated' | 'error';

export interface LoginStatus {
  state: LoginState;
  message: string;
}

export interface QueryFilters {
  type: ReservationType;
  date: string;
  premisesId: string;
  areaId?: string;
  name?: string;
  floor?: string;
  startTime?: string;
  endTime?: string;
}

export interface BlockedInterval {
  startTime: string;
  endTime: string;
}

export interface CandidateBase {
  key: string;
  type: ReservationType;
  queryDate: string;
  targetId: string;
  name: string;
  location: string;
  floor: string;
  available: boolean;
  statusLabel: string;
}

export interface SeatCandidate extends CandidateBase {
  kind: 'seat';
  type: 'seat';
  areaId: string;
  areaName: string;
  segmentId: string;
  actualStartTime: string;
  actualEndTime: string;
}

export interface TitleOption {
  id: string;
  title: string;
}

export interface SpaceCandidate extends CandidateBase {
  kind: 'space';
  type: 'singleStudy' | 'seminar';
  parentId: string;
  topId: string;
  openStartTime: string;
  openEndTime: string;
  blockedIntervals: BlockedInterval[];
  minDurationMinutes: number;
  maxDurationMinutes: number;
  minPersons: number;
  maxPersons: number;
  readonlyTitle: boolean;
  titleOptions: TitleOption[];
}

export type BookingCandidate = SeatCandidate | SpaceCandidate;

export interface QueryMetadata {
  premises: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  availableDates: string[];
}

export interface QueryResponse {
  queriedAt: string;
  filters: QueryFilters;
  metadata: QueryMetadata;
  candidates: BookingCandidate[];
  notices: string[];
}

export interface FavoriteInput {
  type: ReservationType;
  targetId: string;
  name: string;
  location: string;
  floor: string;
  areaId?: string;
}

export interface Favorite extends FavoriteInput {
  id: string;
  priority: number;
  createdAt: string;
}

export interface PreviewInput {
  candidate: BookingCandidate;
  date: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  content?: string;
  mobile?: string;
  teamUserIds?: string[];
}

export interface BookingPreview {
  typeLabel: string;
  candidateName: string;
  location: string;
  date: string;
  timeRange: string;
  title?: string;
  content?: string;
  maskedMobile?: string;
  participantCount?: number;
  warnings: string[];
  submissionEnabled: false;
}

export interface DesktopApi {
  getLoginStatus(): Promise<LoginStatus>;
  openLoginWindow(): Promise<LoginStatus>;
  onLoginStatusChanged(listener: (status: LoginStatus) => void): () => void;
  queryAvailability(filters: QueryFilters): Promise<QueryResponse>;
  createPreview(input: PreviewInput): Promise<BookingPreview>;
  listFavorites(): Promise<Favorite[]>;
  saveFavorite(input: FavoriteInput): Promise<Favorite[]>;
  removeFavorite(favoriteId: string): Promise<Favorite[]>;
  moveFavorite(favoriteId: string, direction: 'up' | 'down'): Promise<Favorite[]>;
}
