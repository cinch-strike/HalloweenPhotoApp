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

  it('AC-07 + reveal: results combine crowd and admin points; TV only sees revealed steps', async () => {
    const admin = await adminToken();
    const [c1] = await categories();
    const [a, b, c, d] = await Promise.all(['A', 'B', 'C', 'D'].map((cap) => submit(c1.id, cap)));
    await call('PUT', '/api/admin/settings', { votingOpen: true }, admin);
    // Crowd: a 2 votes, b 2, c 1, d 1 -> a,b share 1st (3 pts), c,d share 3rd (1 pt).
    await call('POST', '/api/ballots', { id: 'x', voterName: 'X', picks: { [c1.id]: [a, b, c] } }, admin);
    await call('POST', '/api/ballots', { id: 'y', voterName: 'Y', picks: { [c1.id]: [a, b, d] } }, admin);
    await call('PUT', '/api/admin/admin-ballot', { ranks: { [c1.id]: [d, c, b] } }, admin);

    const data = (await call('GET', '/api/admin/data', undefined, admin)).body as { results: Record<string, { photoId: string; total: number; place: number }[]> };
    // a 3+0=3 (2 votes), b 3+1=4, c 1+2=3 (1 vote), d 1+3=4 (1 vote) -> b, d, a, c
    expect(data.results[c1.id].map((r) => [r.photoId, r.total, r.place])).toEqual([[b, 4, 1], [d, 4, 2], [a, 3, 3], [c, 3, 4]]);

    expect(((await call('GET', '/api/state')).body as PublicState).revealed).toBeUndefined();
    await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step: 1 }, admin);
    let state = (await call('GET', '/api/state')).body as PublicState;
    expect(state.revealed!.winners.map((w) => [w.place, w.photo.caption])).toEqual([[3, 'A']]);
    await call('PUT', '/api/admin/reveal', { active: true, catIndex: 0, step: 3 }, admin);
    state = (await call('GET', '/api/state')).body as PublicState;
    expect(state.revealed!.winners.map((w) => w.place)).toEqual([1, 2, 3]);
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
