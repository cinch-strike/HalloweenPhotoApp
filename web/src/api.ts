import type { Category, Picks, PublicPhoto, PublicState, ResultRow, Settings } from '@hpa/shared';

export const ADMIN_KEY = 'hpa.adminToken';
export const KIOSK_KEY = 'hpa.kioskToken';

export function getToken(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function setToken(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch { /* private mode: token lasts for this page only */ }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(method: string, path: string, body?: unknown, token?: string | null): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-auth-token': token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Can’t reach the server — check your connection');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const getState = () => api<PublicState>('GET', '/api/state');
export const getPhotos = () => api<PublicPhoto[]>('GET', '/api/photos');

export interface AdminPhoto extends PublicPhoto {
  status: 'pending' | 'live' | 'hidden';
  submitterName?: string;
  createdAt: string;
}

export interface AdminData {
  settings: Settings;
  categories: Category[];
  photos: AdminPhoto[];
  adminBallot: Picks;
  results: Record<string, ResultRow[]>;
  ballotCount: number;
  voters: { name: string; createdAt: string }[];
  duplicateNames: string[];
  lostVotes: number;
}

/** Upload a resized JPEG via the presigned POST returned by the API, then confirm it. */
export async function uploadPhoto(input: { catId: string; caption: string; submitterName?: string }, jpeg: Blob) {
  const { id, upload } = await api<{ id: string; upload: { url: string; fields: Record<string, string> } }>(
    'POST', '/api/uploads', input,
  );
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append('file', jpeg, 'photo.jpg');
  let res: Response;
  try {
    res = await fetch(upload.url, { method: 'POST', body: form });
  } catch {
    throw new ApiError(0, 'Upload failed — check your connection');
  }
  if (!res.ok) throw new ApiError(res.status, 'Upload failed');
  return api<PublicPhoto>('POST', `/api/uploads/${id}/confirm`);
}

export function byCategory(photos: PublicPhoto[]): Record<string, PublicPhoto[]> {
  const out: Record<string, PublicPhoto[]> = {};
  for (const p of photos) (out[p.catId] ??= []).push(p);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
