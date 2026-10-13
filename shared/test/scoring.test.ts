import { describe, expect, it } from 'vitest';
import { scoreCategory, validateBallot, validateAdminRanks, type Ballot } from '../src';

const C = 'cat1';
let n = 0;
function ballots(counts: Record<string, number>): Ballot[] {
  // Each ballot carries one pick per entry so counts are exact; validation is not the concern here.
  const out: Ballot[] = [];
  for (const [pid, c] of Object.entries(counts)) {
    for (let i = 0; i < c; i++) out.push({ id: `b${n++}`, voterName: 'x', picks: { [C]: [pid] }, createdAt: '' });
  }
  return out;
}

describe('scoreCategory', () => {
  it('matches the worked example agreed with Donnie', () => {
    const rows = scoreCategory(['A', 'B', 'C', 'D', 'E'], ballots({ A: 35, B: 30, C: 25, D: 20, E: 10 }), C, ['D', 'C', 'E']);
    const byId = Object.fromEntries(rows.map((r) => [r.photoId, r]));
    expect(rows.slice(0, 3).map((r) => r.photoId)).toEqual(['A', 'C', 'D']);
    expect(byId.A).toMatchObject({ crowdPoints: 3, adminPoints: 0, total: 3, place: 1, tied: false });
    expect(byId.C).toMatchObject({ crowdPoints: 1, adminPoints: 2, total: 3, place: 2 });
    expect(byId.D).toMatchObject({ crowdPoints: 0, adminPoints: 3, total: 3, place: 3 });
    expect(byId.B).toMatchObject({ total: 2, place: 4 });
    expect(byId.E).toMatchObject({ crowdPoints: 0, adminPoints: 1, total: 1, place: 5 });
  });

  it('gives crowd ties the same higher place (competition ranking)', () => {
    const rows = scoreCategory(['A', 'B', 'C', 'D'], ballots({ A: 10, B: 7, C: 7, D: 3 }), C);
    const byId = Object.fromEntries(rows.map((r) => [r.photoId, r]));
    expect(byId.A.crowdPoints).toBe(3);
    expect(byId.B.crowdPoints).toBe(2);
    expect(byId.C.crowdPoints).toBe(2);
    expect(byId.D.crowdPoints).toBe(0); // 4th place in crowd ranking
  });

  it('breaks total ties by public votes, then admin rank', () => {
    // Every photo totals 3: A 3+0, B 2+1, C 1+2, D 0+3 -> order falls back to public votes.
    let rows = scoreCategory(['A', 'B', 'C', 'D'], ballots({ A: 9, B: 5, C: 1 }), C, ['D', 'C', 'B']);
    expect(rows.map((r) => [r.photoId, r.total, r.place])).toEqual([['A', 3, 1], ['B', 3, 2], ['C', 3, 3], ['D', 3, 4]]);
    // Equal total and votes -> admin rank decides.
    rows = scoreCategory(['A', 'B'], [], C, ['B', 'A']);
    expect(rows.map((r) => r.photoId)).toEqual(['B', 'A']);
  });

  it('flags unbreakable podium ties', () => {
    const rows = scoreCategory(['A', 'B', 'C'], ballots({ A: 4, B: 4, C: 1 }), C);
    expect(rows[0].place).toBe(1);
    expect(rows[1].place).toBe(1);
    expect(rows[0].tied && rows[1].tied).toBe(true);
    expect(rows[2].tied).toBe(false);
  });

  it('ignores votes for photos that are no longer live and photos with zero score are not tied', () => {
    const rows = scoreCategory(['A', 'B', 'C'], ballots({ A: 2, GONE: 50 }), C);
    expect(rows[0]).toMatchObject({ photoId: 'A', publicVotes: 2, crowdPoints: 3 });
    expect(rows[1].tied).toBe(false);
  });

  it('counts a duplicated pick within one ballot once', () => {
    const rows = scoreCategory(['A'], [{ id: 'b', voterName: 'x', picks: { [C]: ['A', 'A'] }, createdAt: '' }], C);
    expect(rows[0].publicVotes).toBe(1);
  });
});

describe('validateBallot', () => {
  const live = { c1: ['a', 'b', 'c', 'd'], c2: ['e', 'f'], c3: [] };
  it('accepts exactly min(3, n) per category', () => {
    expect(validateBallot({ c1: ['a', 'b', 'c'], c2: ['e', 'f'] }, live)).toBeNull();
  });
  it('rejects incomplete categories', () => {
    expect(validateBallot({ c1: ['a', 'b'], c2: ['e', 'f'] }, live)).toMatch(/Pick 3/);
  });
  it('rejects more than 3 picks', () => {
    expect(validateBallot({ c1: ['a', 'b', 'c', 'd'], c2: ['e', 'f'] }, live)).toMatch(/Pick 3/);
  });
  it('rejects duplicates and unknown photos', () => {
    expect(validateBallot({ c1: ['a', 'a', 'b'], c2: ['e', 'f'] }, live)).toMatch(/twice/);
    expect(validateBallot({ c1: ['a', 'b', 'z'], c2: ['e', 'f'] }, live)).toMatch(/no longer/);
  });
  it('rejects unknown categories', () => {
    expect(validateBallot({ c1: ['a', 'b', 'c'], c2: ['e', 'f'], nope: [] }, live)).toMatch(/Unknown/);
  });
});

describe('validateAdminRanks', () => {
  it('allows partial ranking but not more than 3', () => {
    expect(validateAdminRanks({ c1: ['a'] }, { c1: ['a', 'b', 'c', 'd'] })).toBeNull();
    expect(validateAdminRanks({ c1: ['a', 'b', 'c', 'd'] }, { c1: ['a', 'b', 'c', 'd'] })).toMatch(/at most/);
  });
});
