import { describe, expect, it } from 'vitest';
import { adminBonus, scoreCategory, validateBallot, validateAdminRanks, type Ballot } from '../src';

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
  it('counts each guest pick as 1 vote and adds 15% of ballots per admin pick', () => {
    // 28 + 21 + 18 + 15 = 82 single-pick ballots -> bonus round(12.3) = 12
    const rows = scoreCategory(['BLOC', 'B', 'C', 'D'], ballots({ BLOC: 28, B: 21, C: 18, D: 15 }), C, ['B', 'C', 'D']);
    expect(rows.map((r) => [r.photoId, r.publicVotes, r.bonusVotes, r.total, r.place])).toEqual([
      ['B', 21, 12, 33, 1],
      ['C', 18, 12, 30, 2],
      ['BLOC', 28, 0, 28, 3],
      ['D', 15, 12, 27, 4],
    ]);
  });

  it('cannot overturn a clear crowd favourite', () => {
    // 40 + 20 = 60 ballots -> bonus 9; 20 + 9 = 29 < 40
    const rows = scoreCategory(['A', 'B'], ballots({ A: 40, B: 20 }), C, ['B']);
    expect(rows.map((r) => [r.photoId, r.total])).toEqual([['A', 40], ['B', 29]]);
  });

  it('order of admin picks does not matter', () => {
    const b = ballots({ A: 5, B: 3, C: 1 });
    const one = scoreCategory(['A', 'B', 'C'], b, C, ['C', 'B']);
    const two = scoreCategory(['A', 'B', 'C'], b, C, ['B', 'C']);
    expect(one).toEqual(two);
  });

  it('gives at least 1 bonus vote and ignores more than 3 admin picks', () => {
    expect(adminBonus(0)).toBe(1);
    expect(adminBonus(2)).toBe(1);
    expect(adminBonus(100)).toBe(15);
    const rows = scoreCategory(['A', 'B', 'C', 'D'], [], C, ['A', 'B', 'C', 'D']);
    expect(rows.find((r) => r.photoId === 'D')!.bonusVotes).toBe(0);
  });

  it('breaks total ties by guest votes, and flags unbreakable podium ties', () => {
    // 10 + 9 = 19 ballots -> bonus 3; A 10, B 9 + 3 = 12 -> B; then equal totals and votes are a TIE
    let rows = scoreCategory(['A', 'B'], ballots({ A: 10, B: 9 }), C, ['B']);
    expect(rows[0].photoId).toBe('B');
    rows = scoreCategory(['A', 'B', 'C'], ballots({ A: 4, B: 4, C: 1 }), C);
    expect([rows[0].place, rows[1].place]).toEqual([1, 1]);
    expect(rows[0].tied && rows[1].tied).toBe(true);
    expect(rows[2].tied).toBe(false);
  });

  it('settles exact ties with our chosen order, without overriding real differences', () => {
    const b = ballots({ X: 2, Y: 2, Z: 2, W: 3 });
    const rows = scoreCategory(['X', 'Y', 'Z', 'W'], b, C, [], ['Z', 'X', 'Y', 'W']);
    expect(rows.map((r) => [r.photoId, r.place, r.tied])).toEqual([
      ['W', 1, false], // more votes beats the tie-break order
      ['Z', 2, false],
      ['X', 3, false],
      ['Y', 4, false],
    ]);
  });

  it('ignores votes for photos that are no longer live, and counts a duplicated pick once', () => {
    let rows = scoreCategory(['A', 'B'], ballots({ A: 2, GONE: 50 }), C);
    expect(rows[0]).toMatchObject({ photoId: 'A', publicVotes: 2, total: 2 });
    rows = scoreCategory(['A'], [{ id: 'b', voterName: 'x', picks: { [C]: ['A', 'A'] }, createdAt: '' }], C);
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
