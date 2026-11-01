import { beforeEach, describe, expect, it } from 'vitest';
import type { Category, PublicPhoto, PublicState } from '@hpa/shared';
import { createApp, type Req } from '../src/app';
import { hashPasscode } from '../src/auth';
import { MemoryStore } from '../src/memory-store';
import type { Blobs } from '../src/ports';

const uploaded = new Set<string>();
const blobs: Blobs = {
  createUpload: async (key) => ({ url: '/upload', fields: { key } }),
  exists: async (key) => uploaded.has(key),
  delete: async (key) => void uploaded.delete(key),
  url: (key) => `/${key}`,
};
const hash = hashPasscode('secret');

let app: ReturnType<typeof createApp>;
const call = async (method: string, path: string, body?: unknown, token?: string, query: Req['query'] = {}) =>
  app({ method, path, query, headers: token ? { 'x-auth-token': token } : {}, body });

async function adminToken() {
  return ((await call('POST', '/api/admin/login', { passcode: 'secret' })).body as { token: string }).token;
}

async function submit(catId: string, caption = 'Spooky') {
  const r = await call('POST', '/api/uploads', { catId, caption });
  const { id } = r.body as { id: string };
  uploaded.add(`photos/${id}.jpg`);
  await call('POST', `/api/uploads/${id}/confirm`);
  return id;
}

async function categories() {
  return ((await call('GET', '/api/state')).body as PublicState).categories as Category[];
}

beforeEach(() => {
  uploaded.clear();
  app = createApp({ store: new MemoryStore(), blobs, secrets: { passcodeHash: async () => hash, tokenSecret: async () => 't' } });
});

describe('api', () => {
  it('seeds the three default categories in order', async () => {
    expect((await categories()).map((c) => c.name)).toEqual([
      'Best Family Costume',
      'Best Kid Costume',
      'Best Adult Individual Costume',
    ]);
  });

  it('AC-08: refuses admin endpoints without a valid token', async () => {
    expect((await call('GET', '/api/admin/data')).status).toBe(401);
    expect((await call('GET', '/api/admin/data', undefined, 'forged.token')).status).toBe(401);
    expect((await call('POST', '/api/admin/login', { passcode: 'nope' })).status).toBe(401);
    expect((await call('GET', '/api/admin/data', undefined, await adminToken())).status).toBe(200);
  });

  it('only shows a photo once its upload is confirmed', async () => {
    const [cat] = await categories();
    const r = await call('POST', '/api/uploads', { catId: cat.id, caption: 'Witch' });
    const { id } = r.body as { id: string };
    expect((await call('GET', '/api/photos')).body).toEqual([]);
    expect((await call('POST', `/api/uploads/${id}/confirm`)).status).toBe(409); // file not there yet
    uploaded.add(`photos/${id}.jpg`);
    await call('POST', `/api/uploads/${id}/confirm`);
    const photos = (await call('GET', '/api/photos')).body as PublicPhoto[];
    expect(photos).toEqual([{ id, catId: cat.id, caption: 'Witch', url: `/photos/${id}.jpg` }]);
    expect(photos[0]).not.toHaveProperty('submitterName');
  });

  it('AC-09: rejects uploads when submissions are closed', async () => {
    const [cat] = await categories();
    await call('PUT', '/api/admin/settings', { submissionsOpen: false }, await adminToken());
    expect((await call('POST', '/api/uploads', { catId: cat.id, caption: 'x' })).status).toBe(403);
  });

  it('photos per TV screen defaults to 9 and only accepts known layouts', async () => {
    const admin = await adminToken();
    expect(((await call('GET', '/api/state')).body as PublicState).settings.photosPerScreen).toBe(9);
    expect((await call('PUT', '/api/admin/settings', { photosPerScreen: 5 }, admin)).status).toBe(400);
    await call('PUT', '/api/admin/settings', { photosPerScreen: 1 }, admin);
    expect(((await call('GET', '/api/state')).body as PublicState).settings.photosPerScreen).toBe(1);
  });

  it('validates captions', async () => {
    const [cat] = await categories();
    expect((await call('POST', '/api/uploads', { catId: cat.id, caption: '  ' })).status).toBe(400);
    expect((await call('POST', '/api/uploads', { catId: cat.id, caption: 'x'.repeat(81) })).status).toBe(400);
  });

  it('AC-10: hidden photos disappear from public lists', async () => {
    const [cat] = await categories();
    const id = await submit(cat.id);
    await call('PUT', `/api/admin/photos/${id}`, { status: 'hidden' }, await adminToken());
    expect((await call('GET', '/api/photos')).body).toEqual([]);
  });

  it('AC-05/06: ballots need a kiosk token, open voting, and exactly 3 picks per category', async () => {
    const admin = await adminToken();
    const [c1, c2, c3] = await categories();
    const p = await Promise.all([1, 2, 3, 4].map(() => submit(c1.id)));
    const q = await submit(c2.id);
    const kiosk = ((await call('POST', '/api/admin/kiosk-token', undefined, admin)).body as { token: string }).token;
    const ballot = { id: 'b1', voterName: 'Sam', picks: { [c1.id]: p.slice(0, 3), [c2.id]: [q], [c3.id]: [] } };

    expect((await call('POST', '/api/ballots', ballot)).status).toBe(401);
    expect((await call('POST', '/api/ballots', ballot, kiosk)).status).toBe(403); // voting closed
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    expect((await call('POST', '/api/ballots', { ...ballot, picks: { [c1.id]: p.slice(0, 2), [c2.id]: [q] } }, kiosk)).status).toBe(400);
    expect((await call('POST', '/api/ballots', { ...ballot, picks: { [c1.id]: [p[0], p[0], p[1]], [c2.id]: [q] } }, kiosk)).status).toBe(400);
    expect((await call('POST', '/api/ballots', ballot, kiosk)).body).toEqual({ ok: true, duplicate: false });
    expect((await call('POST', '/api/ballots', ballot, kiosk)).body).toEqual({ ok: true, duplicate: true });
    expect((await call('GET', '/api/ballots/check', undefined, kiosk, { name: ' sam ' })).body).toEqual({ voted: true });
  });

  it('AC-07 + reveal: totals are guest votes plus our bonus; TV only sees revealed steps', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map((cap) => submit(c1.id, cap)));
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    // Guest votes: a 4, b 3, c 3, d 2 (4 ballots -> bonus = max(1, round(0.6)) = 1)
    const picks = [[a, b, c], [a, b, d], [a, b, c], [a, c, d]];
    for (const [i, p] of picks.entries()) await call('POST', '/api/ballots', { id: `b${i}`, voterName: `V${i}`, picks: { [c1.id]: p } }, admin);
    await call('PUT', '/api/admin/admin-ballot', { ranks: { [c1.id]: [d, c] } }, admin);

    const data = (await call('GET', '/api/admin/data', undefined, admin)).body as { results: Record<string, { photoId: string; total: number; place: number }[]> };
    // a 4, c 3+1=4 (fewer guest votes), b 3, d 2+1=3 (fewer guest votes)
    expect(data.results[c1.id].map((r) => [r.photoId, r.total, r.place])).toEqual([[a, 4, 1], [c, 4, 2], [b, 3, 3], [d, 3, 4]]);

    expect(((await call('GET', '/api/state')).body as PublicState).revealed).toBeUndefined();
    await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step: 1 }, admin);
    let state = (await call('GET', '/api/state')).body as PublicState;
    expect(state.revealed!.winners.map((w) => [w.place, w.photo.caption])).toEqual([[3, 'B']]);
    await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step: 3 }, admin);
    state = (await call('GET', '/api/state')).body as PublicState;
    expect(state.revealed!.winners.map((w) => w.place)).toEqual([1, 2, 3]);
  });

  it('three-way tie: flagged, settled with a tie-break order, and our picks keep the tie-break', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    const ids = [];
    for (const cap of ['X', 'Y', 'Z']) ids.push(await submit(c1.id, cap));
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    for (const v of ['a', 'b']) await call('POST', '/api/ballots', { id: v, voterName: v, picks: { [c1.id]: ids } }, admin);
    type Data = { results: Record<string, { photoId: string; place: number; tied: boolean }[]> };
    let rows = ((await call('GET', '/api/admin/data', undefined, admin)).body as Data).results[c1.id];
    expect(rows.every((r) => r.tied && r.place === 1)).toBe(true);

    const order = [ids[2], ids[0], ids[1]];
    expect((await call('PUT', '/api/admin/tie-break', { catId: c1.id, order: ['nope'] }, admin)).status).toBe(400);
    expect((await call('PUT', '/api/admin/tie-break', { catId: c1.id, order }, admin)).status).toBe(200);
    await call('PUT', '/api/admin/admin-ballot', { ranks: { [c1.id]: ids } }, admin); // all picked: still equal
    rows = ((await call('GET', '/api/admin/data', undefined, admin)).body as Data).results[c1.id];
    expect(rows.map((r) => [r.photoId, r.place, r.tied])).toEqual([[ids[2], 1, false], [ids[0], 2, false], [ids[1], 3, false]]);
  });

  it('reveal with only two scorers shows 2nd then 1st', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    const [a, b] = [await submit(c1.id, 'A'), await submit(c1.id, 'B')];
    await submit(c1.id, 'C');
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    await call('PUT', '/api/admin/admin-ballot', { ranks: { [c1.id]: [a, b] } }, admin);
    // No guest ballots: only our two picks score (1 bonus vote each), tie settled by order.
    await call('PUT', '/api/admin/tie-break', { catId: c1.id, order: [a, b] }, admin);
    const winners = async (step: number) => {
      await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step }, admin);
      return ((await call('GET', '/api/state')).body as PublicState).revealed!.winners.map((w) => [w.place, w.photo.caption]);
    };
    expect(await winners(1)).toEqual([[2, 'B']]);
    expect(await winners(2)).toEqual([[1, 'A'], [2, 'B']]);
  });

  it('results page is hidden until published (admins can preview), shows totals only, and never exposes photos', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    const [a, b] = [await submit(c1.id, 'A'), await submit(c1.id, 'B')];
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    await call('POST', '/api/ballots', { id: 'v1', voterName: 'V', picks: { [c1.id]: [a, b] } }, admin);
    await call('PUT', '/api/admin/admin-ballot', { ranks: { [c1.id]: [b] } }, admin);

    expect((await call('GET', '/api/results')).status).toBe(403);
    expect((await call('GET', '/api/results', undefined, admin)).status).toBe(200);
    await call('PUT', '/api/admin/settings', { resultsPublished: true }, admin);
    const res = (await call('GET', '/api/results')).body as { categories: { category: Category; rows: Record<string, unknown>[] }[] };
    expect(res.categories).toHaveLength(1); // empty categories are left out
    const rows = res.categories[0].rows;
    expect(rows.map((r) => [r.place, r.votes, r.caption])).toEqual([[1, 2, 'B'], [2, 1, 'A']]);
    expect(Object.keys(rows[0]).sort()).toEqual(['caption', 'place', 'votes']); // no photo URLs

    // Once published, photos are no longer listed publicly or via the reveal; admins still see them.
    expect((await call('GET', '/api/photos')).body).toEqual([]);
    expect(((await call('GET', '/api/photos', undefined, admin)).body as unknown[]).length).toBe(2);
    await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step: 3 }, admin);
    expect(((await call('GET', '/api/state')).body as PublicState).revealed).toBeUndefined();
  });

  it('AC-01: categories can be added, renamed, reordered; non-empty ones cannot be deleted', async () => {
    const admin = await adminToken();
    const added = (await call('POST', '/api/admin/categories', { name: 'Best Pet' }, admin)).body as Category;
    let cats = await categories();
    expect(cats.at(-1)!.name).toBe('Best Pet');
    await call('PUT', '/api/admin/categories-order', { ids: [added.id, ...cats.slice(0, -1).map((c) => c.id)] }, admin);
    cats = await categories();
    expect(cats[0].name).toBe('Best Pet');
    await submit(added.id);
    expect((await call('DELETE', `/api/admin/categories/${added.id}`, undefined, admin)).status).toBe(409);
  });

  it('reset wipes photos, ballots and the admin ballot but keeps categories', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    await submit(c1.id);
    expect((await call('POST', '/api/admin/reset', { confirm: 'nope' }, admin)).status).toBe(400);
    await call('POST', '/api/admin/reset', { confirm: 'RESET' }, admin);
    expect((await call('GET', '/api/photos')).body).toEqual([]);
    expect(uploaded.size).toBe(0);
    expect(await categories()).toHaveLength(3);
  });
});
