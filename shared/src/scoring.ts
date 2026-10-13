import { PICKS_PER_CATEGORY, type Ballot, type Picks, type ResultRow } from './types';

const POINTS = [3, 2, 1];

/**
 * Rank-points scoring for one category (requirements FR-07).
 * Crowd jury: top 3 by public votes get 3/2/1, ties share the higher place (competition ranking).
 * Admin jury: admin 1st/2nd/3rd get 3/2/1.
 * Total = crowd + admin. Tie-breakers: public votes, then admin rank; still tied => flagged.
 */
export function scoreCategory(photoIds: string[], ballots: Ballot[], catId: string, adminRanks: string[] = []): ResultRow[] {
  const ids = new Set(photoIds);
  const votes = new Map(photoIds.map((id) => [id, 0]));
  for (const b of ballots) {
    for (const pid of new Set(b.picks[catId] ?? [])) {
      if (ids.has(pid)) votes.set(pid, votes.get(pid)! + 1);
    }
  }

  const rows: ResultRow[] = photoIds.map((photoId) => {
    const publicVotes = votes.get(photoId)!;
    const crowdRank = 1 + photoIds.filter((other) => votes.get(other)! > publicVotes).length;
    const crowdPoints = publicVotes > 0 && crowdRank <= POINTS.length ? POINTS[crowdRank - 1] : 0;
    const idx = adminRanks.indexOf(photoId);
    const adminRank = idx >= 0 && idx < POINTS.length ? idx + 1 : null;
    const adminPoints = adminRank ? POINTS[adminRank - 1] : 0;
    return { photoId, publicVotes, crowdPoints, adminRank, adminPoints, total: crowdPoints + adminPoints, place: 0, tied: false };
  });

  const cmp = (a: ResultRow, b: ResultRow) =>
    b.total - a.total || b.publicVotes - a.publicVotes || (a.adminRank ?? 99) - (b.adminRank ?? 99);
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

/** Admin ranks may be saved partially, but must be unique live photos and at most 3 per category. */
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
