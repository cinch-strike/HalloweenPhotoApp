import { randomUUID } from 'node:crypto';
import {
  CAPTION_MAX,
  DEFAULT_CATEGORIES,
  DEFAULT_SETTINGS,
  MAX_UPLOAD_BYTES,
  NAME_MAX,
  scoreCategory,
  validateAdminRanks,
  validateBallot,
  type Ballot,
  type Category,
  type Photo,
  type Picks,
  type PublicPhoto,
  type PublicState,
  type ResultRow,
  type Settings,
} from '@hpa/shared';
import { issueToken, readToken, verifyPasscode, type Role } from './auth';
import type { Deps } from './ports';

export interface Req {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  body: unknown;
}

export interface Res {
  status: number;
  body?: unknown;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ADMIN_TTL = 12 * 3600;
const KIOSK_TTL = 7 * 24 * 3600;

const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};

function str(v: unknown, field: string, max: number, { required = true } = {}): string {
  if (v === undefined || v === null || v === '') {
    if (required) fail(400, `${field} is required`);
    return '';
  }
  if (typeof v !== 'string') fail(400, `${field} must be text`);
  const s = (v as string).trim();
  if (required && !s) fail(400, `${field} is required`);
  if (s.length > max) fail(400, `${field} must be ${max} characters or fewer`);
  return s;
}

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function createApp(deps: Deps) {
  const { store, blobs, secrets } = deps;
  const now = deps.now ?? (() => new Date());

  async function settings(): Promise<Settings> {
    const s = await store.getSettings();
    if (s) return s;
    // First run: seed default categories. The conditional write stops concurrent first requests seeding twice.
    if (await store.createSettingsIfAbsent(DEFAULT_SETTINGS)) {
      await Promise.all(
        DEFAULT_CATEGORIES.map((name, i) => store.putCategory({ id: randomUUID(), name, sortOrder: i })),
      );
    }
    return (await store.getSettings()) ?? DEFAULT_SETTINGS;
  }

  async function sortedCategories() {
    await settings(); // ensures first-run seeding has happened
    return (await store.listCategories()).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  const toPublic = (p: Photo): PublicPhoto => ({ id: p.id, catId: p.catId, caption: p.caption, url: blobs.url(p.key) });

  async function livePhotosByCategory(categories: Category[]) {
    const photos = (await store.listPhotos())
      .filter((p) => p.status === 'live')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const byCat: Record<string, string[]> = Object.fromEntries(categories.map((c) => [c.id, []]));
    for (const p of photos) byCat[p.catId]?.push(p.id);
    return { photos, byCat };
  }

  async function results(categories: Category[]) {
    const { photos, byCat } = await livePhotosByCategory(categories);
    const [ballots, admin] = await Promise.all([store.listBallots(), store.getAdminBallot()]);
    const out: Record<string, ResultRow[]> = {};
    for (const c of categories) out[c.id] = scoreCategory(byCat[c.id], ballots, c.id, admin?.ranks[c.id] ?? []);
    return { out, photos, ballots, admin };
  }

  async function role(req: Req): Promise<Role | null> {
    // A custom header rather than Authorization: CloudFront forwards it to the API without caching rules.
    const token = req.headers['x-auth-token'];
    return readToken(token, await secrets.tokenSecret(), now().getTime());
  }

  async function requireRole(req: Req, ...allowed: Role[]) {
    const r = await role(req);
    if (!r || !allowed.includes(r)) fail(401, 'Not authorised');
  }

  // ---------- public ----------

  async function getState(): Promise<PublicState> {
    const [s, categories] = await Promise.all([settings(), sortedCategories()]);
    const state: PublicState = { categories, settings: s };
    if (s.reveal.active && categories[s.reveal.catIndex]) {
      const category = categories[s.reveal.catIndex];
      const { out, photos } = await results([category]);
      const podium = out[category.id].filter((r) => r.total > 0).slice(0, 3);
      // step 1 reveals 3rd, step 2 adds 2nd, step 3 adds 1st.
      const shown = podium.filter((_, i) => i >= 3 - s.reveal.step);
      const byId = new Map(photos.map((p) => [p.id, p]));
      state.revealed = {
        category,
        winners: shown.map((r) => ({ place: r.place, photo: toPublic(byId.get(r.photoId)!) })),
      };
    }
    return state;
  }

  async function listPublicPhotos(): Promise<PublicPhoto[]> {
    const { photos } = await livePhotosByCategory(await sortedCategories());
    return photos.map(toPublic);
  }

  async function createUpload(body: Record<string, unknown>) {
    const s = await settings();
    if (!s.submissionsOpen) fail(403, 'Submissions are closed');
    const catId = str(body.catId, 'Category', 64);
    if (!(await sortedCategories()).some((c) => c.id === catId)) fail(400, 'Unknown category');
    const caption = str(body.caption, 'Caption', CAPTION_MAX);
    const submitterName = str(body.submitterName, 'Name', NAME_MAX, { required: false }) || undefined;
    const id = randomUUID();
    const key = `photos/${id}.jpg`;
    await store.putPhoto({ id, catId, caption, submitterName, key, status: 'pending', createdAt: now().toISOString() });
    return { id, upload: await blobs.createUpload(key, MAX_UPLOAD_BYTES) };
  }

  async function confirmUpload(id: string) {
    const photo = (await store.getPhoto(id)) ?? fail(404, 'Photo not found');
    if (photo.status !== 'pending') return toPublic(photo);
    if (!(await blobs.exists(photo.key))) fail(409, 'Photo file was not uploaded');
    const live: Photo = { ...photo, status: 'live' };
    await store.putPhoto(live);
    return toPublic(live);
  }

  async function submitBallot(body: Record<string, unknown>) {
    const s = await settings();
    if (!s.votingOpen) fail(403, 'Voting is not open');
    const id = str(body.id, 'Ballot id', 64);
    const voterName = str(body.voterName, 'Name', NAME_MAX);
    const picks = obj(body.picks) as Picks;
    const { byCat } = await livePhotosByCategory(await sortedCategories());
    const error = validateBallot(picks, byCat);
    if (error) fail(400, error);
    const ballot: Ballot = { id, voterName, picks, createdAt: now().toISOString() };
    const created = await store.putBallotIfNew(ballot);
    return { ok: true, duplicate: !created };
  }

  const normName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');

  async function nameHasVoted(name: string) {
    const target = normName(name);
    return (await store.listBallots()).some((b) => normName(b.voterName) === target);
  }

  // ---------- admin ----------

  async function login(body: Record<string, unknown>) {
    const hash = await secrets.passcodeHash();
    if (!hash) fail(503, 'Admin passcode has not been set up');
    const passcode = str(body.passcode, 'Passcode', 200);
    if (!verifyPasscode(passcode, hash!)) fail(401, 'Wrong passcode');
    return { token: issueToken('admin', ADMIN_TTL, await secrets.tokenSecret(), now().getTime()) };
  }

  async function adminData() {
    const [s, categories] = await Promise.all([settings(), sortedCategories()]);
    const { out, ballots, admin } = await results(categories);
    const photos = (await store.listPhotos()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const counts = new Map<string, number>();
    for (const b of ballots) counts.set(normName(b.voterName), (counts.get(normName(b.voterName)) ?? 0) + 1);
    // Votes cast for photos that were later hidden or deleted don't count; surface that.
    const live = new Set(photos.filter((p) => p.status === 'live').map((p) => p.id));
    const lostVotes = ballots.reduce(
      (n, b) => n + Object.values(b.picks).flat().filter((id) => !live.has(id)).length,
      0,
    );
    return {
      settings: s,
      categories,
      photos: photos.map((p) => ({ ...toPublic(p), status: p.status, submitterName: p.submitterName, createdAt: p.createdAt })),
      adminBallot: admin?.ranks ?? {},
      results: out,
      ballotCount: ballots.length,
      voters: ballots.map((b) => ({ name: b.voterName, createdAt: b.createdAt })).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      duplicateNames: [...counts].filter(([, c]) => c > 1).map(([n]) => n),
      lostVotes,
    };
  }

  async function addCategory(body: Record<string, unknown>) {
    const name = str(body.name, 'Name', 60);
    const categories = await sortedCategories();
    const c: Category = { id: randomUUID(), name, sortOrder: Math.max(-1, ...categories.map((x) => x.sortOrder)) + 1 };
    await store.putCategory(c);
    return c;
  }

  async function updateCategory(id: string, body: Record<string, unknown>) {
    const c = (await sortedCategories()).find((x) => x.id === id) ?? fail(404, 'Category not found');
    const updated = { ...c, name: body.name === undefined ? c.name : str(body.name, 'Name', 60) };
    await store.putCategory(updated);
    return updated;
  }

  async function reorderCategories(body: Record<string, unknown>) {
    const ids = Array.isArray(body.ids) ? (body.ids as string[]) : fail(400, 'ids required');
    const categories = await sortedCategories();
    if (ids.length !== categories.length || !categories.every((c) => ids.includes(c.id))) fail(400, 'ids must list every category');
    await Promise.all(categories.map((c) => store.putCategory({ ...c, sortOrder: ids.indexOf(c.id) })));
    return sortedCategories();
  }

  async function deleteCategory(id: string) {
    if ((await store.listPhotos()).some((p) => p.catId === id)) fail(409, 'Move or delete this category’s photos first');
    await store.deleteCategory(id);
    const s = await settings();
    const categories = await sortedCategories();
    if (s.reveal.catIndex >= categories.length) await store.putSettings({ ...s, reveal: { active: false, catIndex: 0, step: 0 } });
    return { ok: true };
  }

  async function updatePhoto(id: string, body: Record<string, unknown>) {
    const p = (await store.getPhoto(id)) ?? fail(404, 'Photo not found');
    const next: Photo = { ...p };
    if (body.caption !== undefined) next.caption = str(body.caption, 'Caption', CAPTION_MAX);
    if (body.catId !== undefined) {
      const catId = str(body.catId, 'Category', 64);
      if (!(await sortedCategories()).some((c) => c.id === catId)) fail(400, 'Unknown category');
      next.catId = catId;
    }
    if (body.status !== undefined) {
      if (body.status !== 'live' && body.status !== 'hidden') fail(400, 'status must be live or hidden');
      next.status = body.status as Photo['status'];
    }
    await store.putPhoto(next);
    return next;
  }

  async function deletePhoto(id: string) {
    const p = await store.getPhoto(id);
    if (p) {
      await blobs.delete(p.key);
      await store.deletePhoto(id);
    }
    return { ok: true };
  }

  async function updateSettings(body: Record<string, unknown>) {
    const s = await settings();
    const next: Settings = { ...s };
    if (typeof body.submissionsOpen === 'boolean') next.submissionsOpen = body.submissionsOpen;
    if (typeof body.votingOpen === 'boolean') next.votingOpen = body.votingOpen;
    if (body.carouselSeconds !== undefined) {
      const n = Number(body.carouselSeconds);
      if (!Number.isInteger(n) || n < 3 || n > 120) fail(400, 'Carousel seconds must be 3–120');
      next.carouselSeconds = n;
    }
    await store.putSettings(next);
    return next;
  }

  async function setReveal(body: Record<string, unknown>) {
    const s = await settings();
    const categories = await sortedCategories();
    const catIndex = Number(body.catIndex ?? 0);
    const step = Number(body.step ?? 0);
    if (!Number.isInteger(catIndex) || catIndex < 0 || catIndex >= Math.max(1, categories.length)) fail(400, 'Bad category');
    if (!Number.isInteger(step) || step < 0 || step > 3) fail(400, 'Bad step');
    const next = { ...s, reveal: { active: Boolean(body.active), catIndex, step } };
    await store.putSettings(next);
    return next;
  }

  async function saveAdminBallot(body: Record<string, unknown>) {
    const ranks = obj(body.ranks) as Picks;
    const { byCat } = await livePhotosByCategory(await sortedCategories());
    const error = validateAdminRanks(ranks, byCat);
    if (error) fail(400, error);
    await store.putAdminBallot({ ranks, updatedAt: now().toISOString() });
    return { ok: true };
  }

  async function reset(body: Record<string, unknown>) {
    if (body.confirm !== 'RESET') fail(400, 'Type RESET to confirm');
    for (const p of await store.listPhotos()) {
      await blobs.delete(p.key);
      await store.deletePhoto(p.id);
    }
    await store.deleteAllBallots();
    await store.putAdminBallot(null);
    const s = await settings();
    await store.putSettings({ ...s, reveal: DEFAULT_SETTINGS.reveal });
    return { ok: true };
  }

  // ---------- router ----------

  async function route(req: Req): Promise<unknown> {
    const { method } = req;
    const path = req.path.replace(/\/+$/, '');
    const body = obj(req.body);
    const m = (re: RegExp) => path.match(re);
    let x: RegExpMatchArray | null;

    if (method === 'GET' && path === '/api/state') return getState();
    if (method === 'GET' && path === '/api/photos') return listPublicPhotos();
    if (method === 'POST' && path === '/api/uploads') return createUpload(body);
    if (method === 'POST' && (x = m(/^\/api\/uploads\/([\w-]+)\/confirm$/))) return confirmUpload(x[1]);

    if (method === 'POST' && path === '/api/ballots') {
      await requireRole(req, 'kiosk', 'admin');
      return submitBallot(body);
    }
    if (method === 'GET' && path === '/api/ballots/check') {
      await requireRole(req, 'kiosk', 'admin');
      return { voted: await nameHasVoted(req.query.name ?? '') };
    }
    if (method === 'GET' && path === '/api/kiosk/check') {
      await requireRole(req, 'kiosk', 'admin');
      return { ok: true };
    }

    if (method === 'POST' && path === '/api/admin/login') return login(body);
    if (path.startsWith('/api/admin/')) {
      await requireRole(req, 'admin');
      if (method === 'GET' && path === '/api/admin/data') return adminData();
      if (method === 'POST' && path === '/api/admin/kiosk-token')
        return { token: issueToken('kiosk', KIOSK_TTL, await secrets.tokenSecret(), now().getTime()) };
      if (method === 'POST' && path === '/api/admin/categories') return addCategory(body);
      if (method === 'PUT' && path === '/api/admin/categories-order') return reorderCategories(body);
      if (method === 'PUT' && (x = m(/^\/api\/admin\/categories\/([\w-]+)$/))) return updateCategory(x[1], body);
      if (method === 'DELETE' && (x = m(/^\/api\/admin\/categories\/([\w-]+)$/))) return deleteCategory(x[1]);
      if (method === 'PUT' && (x = m(/^\/api\/admin\/photos\/([\w-]+)$/))) return updatePhoto(x[1], body);
      if (method === 'DELETE' && (x = m(/^\/api\/admin\/photos\/([\w-]+)$/))) return deletePhoto(x[1]);
      if (method === 'PUT' && path === '/api/admin/settings') return updateSettings(body);
      if (method === 'PUT' && path === '/api/admin/reveal') return setReveal(body);
      if (method === 'PUT' && path === '/api/admin/admin-ballot') return saveAdminBallot(body);
      if (method === 'POST' && path === '/api/admin/reset') return reset(body);
    }
    return fail(404, 'Not found');
  }

  return async function handle(req: Req): Promise<Res> {
    try {
      return { status: 200, body: await route(req) };
    } catch (e) {
      if (e instanceof HttpError) return { status: e.status, body: { error: e.message } };
      console.error(e);
      return { status: 500, body: { error: 'Something went wrong' } };
    }
  };
}
