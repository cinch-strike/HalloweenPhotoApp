import type { AdminBallot, Ballot, Category, Photo, Settings } from '@hpa/shared';

/** Persistence. Implemented by the in-memory dev store and the DynamoDB store. */
export interface Store {
  getSettings(): Promise<Settings | null>;
  putSettings(s: Settings): Promise<void>;
  /** Writes settings only if none exist; returns true if this call created them. */
  createSettingsIfAbsent(s: Settings): Promise<boolean>;
  listCategories(): Promise<Category[]>;
  putCategory(c: Category): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  listPhotos(): Promise<Photo[]>;
  getPhoto(id: string): Promise<Photo | null>;
  putPhoto(p: Photo): Promise<void>;
  deletePhoto(id: string): Promise<void>;
  listBallots(): Promise<Ballot[]>;
  /** Returns false if a ballot with this id already exists (idempotent retry). */
  putBallotIfNew(b: Ballot): Promise<boolean>;
  deleteAllBallots(): Promise<void>;
  getAdminBallot(): Promise<AdminBallot | null>;
  putAdminBallot(b: AdminBallot | null): Promise<void>;
}

export interface PresignedUpload {
  url: string;
  fields: Record<string, string>;
}

/** Photo file storage. Implemented by a local folder in dev and S3 in AWS. */
export interface Blobs {
  createUpload(key: string, maxBytes: number): Promise<PresignedUpload>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  url(key: string): string;
}

export interface Secrets {
  /** "scrypt$<salt hex>$<hash hex>", or null if not configured yet. */
  passcodeHash(): Promise<string | null>;
  tokenSecret(): Promise<string>;
}

export interface Deps {
  store: Store;
  blobs: Blobs;
  secrets: Secrets;
  now?: () => Date;
}
