import { PICKS_PER_CATEGORY, type Ballot, type Picks, type ResultRow } from './types';

/** Each of our (admin) picks adds bonus votes worth this share of the ballots cast. */
export const ADMIN_BONUS_SHARE = 0.15;

/** Bonus votes per admin pick: 15% of ballots cast, rounded, and at least 1 so our picks always count. */
export function adminBonus(ballotCount: number): number {
  return Math.max(1, Math.round(ballotCount * ADMIN_BONUS_SHARE));
}

/**
 * Scoring for one category (requirements FR-07, revised 2026-10-30).
 * Every guest pick is 1 vote. Each of our (unranked) picks adds adminBonus(ballots) votes, so we can
 * sway a close race but not overturn a clear crowd favourite.
 * Ties go to more guest votes, then to the order we set to settle the tie; otherwise flagged for a decision.
 */
export function scoreCategory(
  photoIds: string[],
  ballots: Ballot[],
  catId: string,
  adminPicks: string[] = [],
  tieBreak: string[] = [],
  adjustments: Record<string, number> = {},
): ResultRow[] {
  const ids = new Set(photoIds);
  const votes = new Map(photoIds.map((id) => [id, 0]));
  for (const b of ballots) {
    for (const pid of new Set(b.picks[catId] ?? [])) {
      if (ids.has(pid)) votes.set(pid, votes.get(pid)! + 1);
    }
  }
  const bonus = adminBonus(ballots.length);
  const picks = new Set(adminPicks.slice(0, PICKS_PER_CATEGORY));

  const rows: ResultRow[] = photoIds.map((photoId) => {
    const publicVotes = votes.get(photoId)!;
    const adminPick = picks.has(photoId);
    const bonusVotes = adminPick ? bonus : 0;
    const adjustment = adjustments[photoId] ?? 0;
    return { photoId, publicVotes, adminPick, bonusVotes, adjustment, total: publicVotes + bonusVotes + adjustment, place: 0, tied: false };
  });

  const tb = (id: string) => (tieBreak.includes(id) ? tieBreak.indexOf(id) : Number.MAX_SAFE_INTEGER);
  const cmp = (a: ResultRow, b: ResultRow) => b.total - a.total || b.publicVotes - a.publicVotes || tb(a.photoId) - tb(b.photoId);
  rows.sort(cmp);

  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.place = prev && cmp(prev, row) === 0 ? prev.place : i + 1;
  });
  for (const row of rows) {
    // Only ties that matter (scored something and land on the podium) need a human decision.
    row.tied = row.total > 0 && row.place <= PICKS_PER_CATEGORY && rows.some((o) => o !== row && o.place === row.place);
  }
  return rows;
}

/** Returns an error message, or null if the ballot is valid. livePhotos: catId -> live photo ids. */
export function validateBallot(picks: Picks, livePhotos: Record<string, string[]>): string | null {
  for (const catId of Object.keys(picks)) {
    if (!(catId in livePhotos)) return `Unknown category ${catId}`;
  }
  for (const [catId, photoIds] of Object.entries(livePhotos)) {
    const chosen = picks[catId] ?? [];
    const required = Math.min(PICKS_PER_CATEGORY, photoIds.length);
    if (!Array.isArray(chosen)) return 'Invalid picks';
    if (new Set(chosen).size !== chosen.length) return 'The same photo was picked twice';
    if (chosen.length !== required) return `Pick ${required} photos in every category`;
    if (chosen.some((id) => !photoIds.includes(id))) return 'A picked photo is no longer available';
  }
  return null;
}

/** Admin picks may be saved partially, but must be unique live photos and at most 3 per category. */
export function validateAdminRanks(ranks: Picks, livePhotos: Record<string, string[]>): string | null {
  for (const [catId, chosen] of Object.entries(ranks)) {
    const photoIds = livePhotos[catId];
    if (!photoIds) return `Unknown category ${catId}`;
    if (!Array.isArray(chosen) || chosen.length > PICKS_PER_CATEGORY) return 'Rank at most 3 photos';
    if (new Set(chosen).size !== chosen.length) return 'The same photo was ranked twice';
    if (chosen.some((id) => !photoIds.includes(id))) return 'A ranked photo is no longer available';
  }
  return null;
}
