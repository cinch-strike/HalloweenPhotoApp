/** Local dev server: the same app as the Lambda, with a JSON-file store and photos on local disk. */
import { createServer, type IncomingMessage } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { Readable } from 'node:stream';
import { MAX_UPLOAD_BYTES } from '@hpa/shared';
import { createApp } from './app';
import { hashPasscode } from './auth';
import { MemoryStore } from './memory-store';
import type { Blobs } from './ports';

const PORT = Number(process.env.API_PORT ?? 8787);
const DATA = join(import.meta.dirname, '../../.dev-data');
const PASSCODE = process.env.DEV_ADMIN_PASSCODE ?? 'boo';
const filePath = (key: string) => {
  const p = normalize(join(DATA, key));
  if (!p.startsWith(join(DATA, 'photos'))) throw new Error('bad key');
  return p;
};

const blobs: Blobs = {
  async createUpload(key) {
    return { url: '/dev-upload', fields: { key, 'Content-Type': 'image/jpeg' } };
  },
  async exists(key) { return existsSync(filePath(key)); },
  async delete(key) { rmSync(filePath(key), { force: true }); },
  url(key) { return `/${key}`; },
};

const passcodeHash = hashPasscode(PASSCODE);
const handle = createApp({
  store: new MemoryStore(join(DATA, 'db.json')),
  blobs,
  secrets: { passcodeHash: async () => passcodeHash, tokenSecret: async () => 'dev-only-secret' },
});

const toRequest = (req: IncomingMessage) =>
  new Request(`http://localhost${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (Readable.toWeb(req) as ReadableStream),
    duplex: 'half',
  } as RequestInit);

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      const text = await toRequest(req).text();
      const out = await handle({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers as Record<string, string>,
        body: text ? JSON.parse(text) : undefined,
      });
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body ?? null));
    } else if (url.pathname === '/dev-upload' && req.method === 'POST') {
      // Mimics an S3 presigned POST: form fields first, then "file".
      const form = await toRequest(req).formData();
      const file = form.get('file');
      const key = String(form.get('key'));
      if (!(file instanceof Blob) || file.size > MAX_UPLOAD_BYTES || form.get('Content-Type') !== 'image/jpeg') {
        res.writeHead(400).end('bad upload');
        return;
      }
      mkdirSync(dirname(filePath(key)), { recursive: true });
      writeFileSync(filePath(key), Buffer.from(await file.arrayBuffer()));
      res.writeHead(204).end();
    } else if (url.pathname.startsWith('/photos/') && req.method === 'GET') {
      const p = filePath(url.pathname.slice(1));
      if (!existsSync(p)) res.writeHead(404).end();
      else res.writeHead(200, { 'content-type': 'image/jpeg' }).end(readFileSync(p));
    } else {
      res.writeHead(404).end();
    }
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}).listen(PORT, () => console.log(`API dev server on http://localhost:${PORT} (admin passcode: ${PASSCODE})`));
