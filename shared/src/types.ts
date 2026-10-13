export type PhotoStatus = 'pending' | 'live' | 'hidden';

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
}

export interface Photo {
  id: string;
  catId: string;
  caption: string;
  submitterName?: string;
  key: string;
  status: PhotoStatus;
  createdAt: string;
}

/** What non-admin screens see: no submitter name, no status. */
export interface PublicPhoto {
  id: string;
  catId: string;
  caption: string;
  url: string;
}

/** catId -> photo ids. Public ballots are unranked; the admin ballot is ordered 1st, 2nd, 3rd. */
export type Picks = Record<string, string[]>;

export interface Ballot {
  id: string;
  voterName: string;
  picks: Picks;
  createdAt: string;
}

export interface AdminBallot {
  ranks: Picks;
  updatedAt: string;
}

/** step 0 = category title, 1 = 3rd place, 2 = 2nd place, 3 = 1st place. */
export interface RevealState {
  active: boolean;
  catIndex: number;
  step: number;
}

export interface Settings {
  submissionsOpen: boolean;
  votingOpen: boolean;
  carouselSeconds: number;
  reveal: RevealState;
}

export interface ResultRow {
  photoId: string;
  publicVotes: number;
  crowdPoints: number;
  adminRank: number | null;
  adminPoints: number;
  total: number;
  place: number;
  tied: boolean;
}

export interface RevealedWinner {
  place: number;
  photo: PublicPhoto;
}

export interface PublicState {
  categories: Category[];
  settings: Settings;
  /** Only present while reveal is active: winners revealed so far for the current category. */
  revealed?: { category: Category; winners: RevealedWinner[] };
}

export const CAPTION_MAX = 80;
export const NAME_MAX = 40;
export const PICKS_PER_CATEGORY = 3;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export const DEFAULT_CATEGORIES = ['Best Family Costume', 'Best Kid Costume', 'Best Adult Individual Costume'];

export const DEFAULT_SETTINGS: Settings = {
  submissionsOpen: true,
  votingOpen: false,
  carouselSeconds: 10,
  reveal: { active: false, catIndex: 0, step: 0 },
};
