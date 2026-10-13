import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { createApp } from './app';
import { DynamoStore, S3Blobs, SsmSecrets } from './aws';

const handle = createApp({
  store: new DynamoStore(process.env.TABLE_NAME!),
  blobs: new S3Blobs(process.env.PHOTOS_BUCKET!),
  secrets: new SsmSecrets(process.env.PARAM_PREFIX!),
});

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  let body: unknown;
  if (event.body) {
    try {
      body = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }
  }
  const res = await handle({
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: event.queryStringParameters ?? {},
    headers: event.headers ?? {},
    body,
  });
  return {
    statusCode: res.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(res.body ?? null),
  };
}
