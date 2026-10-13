import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, HeadObjectCommand, NotFound, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { GetParameterCommand, ParameterNotFound, SSMClient } from '@aws-sdk/client-ssm';
import type { AdminBallot, Ballot, Category, Photo, Settings } from '@hpa/shared';
import type { Blobs, Secrets, Store } from './ports';

/** Single-table layout: PK = item type, SK = id (see docs/02-design §10). */
export class DynamoStore implements Store {
  private db: DynamoDBDocumentClient;

  constructor(private table: string, client = new DynamoDBClient({})) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  private async get<T>(pk: string, sk: string): Promise<T | null> {
    const r = await this.db.send(new GetCommand({ TableName: this.table, Key: { pk, sk }, ConsistentRead: true }));
    return (r.Item?.data as T) ?? null;
  }

  private async put(pk: string, sk: string, data: unknown, ifAbsent = false): Promise<boolean> {
    try {
      await this.db.send(new PutCommand({
        TableName: this.table,
        Item: { pk, sk, data },
        ...(ifAbsent ? { ConditionExpression: 'attribute_not_exists(pk)' } : {}),
      }));
      return true;
    } catch (e) {
      if (e instanceof ConditionalCheckFailedException) return false;
      throw e;
    }
  }

  private async del(pk: string, sk: string) {
    await this.db.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }

  private async list<T>(pk: string): Promise<T[]> {
    const out: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.db.send(new QueryCommand({
        TableName: this.table,
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ConsistentRead: true,
        ExclusiveStartKey,
      }));
      out.push(...(r.Items ?? []).map((i) => i.data as T));
      ExclusiveStartKey = r.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return out;
  }

  getSettings() { return this.get<Settings>('SETTINGS', 'current'); }
  async putSettings(s: Settings) { await this.put('SETTINGS', 'current', s); }
  createSettingsIfAbsent(s: Settings) { return this.put('SETTINGS', 'current', s, true); }
  listCategories() { return this.list<Category>('CAT'); }
  async putCategory(c: Category) { await this.put('CAT', c.id, c); }
  deleteCategory(id: string) { return this.del('CAT', id); }
  listPhotos() { return this.list<Photo>('PHOTO'); }
  getPhoto(id: string) { return this.get<Photo>('PHOTO', id); }
  async putPhoto(p: Photo) { await this.put('PHOTO', p.id, p); }
  deletePhoto(id: string) { return this.del('PHOTO', id); }
  listBallots() { return this.list<Ballot>('BALLOT'); }
  putBallotIfNew(b: Ballot) { return this.put('BALLOT', b.id, b, true); }
  async deleteAllBallots() {
    const ids = (await this.list<Ballot>('BALLOT')).map((b) => b.id);
    for (let i = 0; i < ids.length; i += 25) {
      await this.db.send(new BatchWriteCommand({
        RequestItems: { [this.table]: ids.slice(i, i + 25).map((id) => ({ DeleteRequest: { Key: { pk: 'BALLOT', sk: id } } })) },
      }));
    }
  }
  getAdminBallot() { return this.get<AdminBallot>('ADMIN_BALLOT', 'current'); }
  async putAdminBallot(b: AdminBallot | null) {
    if (b) await this.put('ADMIN_BALLOT', 'current', b);
    else await this.del('ADMIN_BALLOT', 'current');
  }
}

export class S3Blobs implements Blobs {
  constructor(private bucket: string, private s3 = new S3Client({})) {}

  async createUpload(key: string, maxBytes: number) {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [['content-length-range', 1, maxBytes], ['eq', '$Content-Type', 'image/jpeg']],
      Fields: { 'Content-Type': 'image/jpeg' },
      Expires: 300,
    });
    return { url, fields };
  }

  async exists(key: string) {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === 'NotFound') return false;
      throw e;
    }
  }

  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  /** Photos are served by CloudFront at the same path as the S3 key. */
  url(key: string) {
    return `/${key}`;
  }
}

/** Reads the passcode hash and token secret from SSM once per Lambda container. */
export class SsmSecrets implements Secrets {
  private cache = new Map<string, string | null>();

  constructor(private prefix: string, private ssm = new SSMClient({})) {}

  private async param(name: string): Promise<string | null> {
    if (this.cache.get(name)) return this.cache.get(name)!;
    try {
      const r = await this.ssm.send(new GetParameterCommand({ Name: `${this.prefix}/${name}`, WithDecryption: true }));
      const v = r.Parameter?.Value ?? null;
      this.cache.set(name, v);
      return v;
    } catch (e) {
      if (e instanceof ParameterNotFound) return null;
      throw e;
    }
  }

  passcodeHash() { return this.param('admin-passcode-hash'); }

  async tokenSecret() {
    const v = await this.param('token-secret');
    if (!v) throw new Error('token-secret parameter is missing — run npm run set-passcode');
    return v;
  }
}
