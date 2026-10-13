import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AdminBallot, Ballot, Category, Photo, Settings } from '@hpa/shared';
import type { Store } from './ports';

interface Data {
  settings: Settings | null;
  categories: Record<string, Category>;
  photos: Record<string, Photo>;
  ballots: Record<string, Ballot>;
  adminBallot: AdminBallot | null;
}

const clone = <T>(v: T): T => structuredClone(v);

/** In-memory store for tests and local dev. Pass a file path to persist across dev-server restarts. */
export class MemoryStore implements Store {
  private data: Data = { settings: null, categories: {}, photos: {}, ballots: {}, adminBallot: null };

  constructor(private file?: string) {
    if (file && existsSync(file)) this.data = JSON.parse(readFileSync(file, 'utf8'));
  }

  private save() {
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  async getSettings() { return clone(this.data.settings); }
  async putSettings(s: Settings) { this.data.settings = clone(s); this.save(); }
  async createSettingsIfAbsent(s: Settings) {
    if (this.data.settings) return false;
    await this.putSettings(s);
    return true;
  }
  async listCategories() { return clone(Object.values(this.data.categories)); }
  async putCategory(c: Category) { this.data.categories[c.id] = clone(c); this.save(); }
  async deleteCategory(id: string) { delete this.data.categories[id]; this.save(); }
  async listPhotos() { return clone(Object.values(this.data.photos)); }
  async getPhoto(id: string) { return clone(this.data.photos[id] ?? null); }
  async putPhoto(p: Photo) { this.data.photos[p.id] = clone(p); this.save(); }
  async deletePhoto(id: string) { delete this.data.photos[id]; this.save(); }
  async listBallots() { return clone(Object.values(this.data.ballots)); }
  async putBallotIfNew(b: Ballot) {
    if (this.data.ballots[b.id]) return false;
    this.data.ballots[b.id] = clone(b);
    this.save();
    return true;
  }
  async deleteAllBallots() { this.data.ballots = {}; this.save(); }
  async getAdminBallot() { return clone(this.data.adminBallot); }
  async putAdminBallot(b: AdminBallot | null) { this.data.adminBallot = clone(b); this.save(); }
}
