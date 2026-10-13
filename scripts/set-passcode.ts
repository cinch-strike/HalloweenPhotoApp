/**
 * Sets the admin passcode in the deployed AWS account (and creates the token-signing secret on first run).
 * Usage: AWS_PROFILE=halloween npm run set-passcode
 */
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { GetParameterCommand, ParameterNotFound, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { hashPasscode } from '../api/src/auth';

const PREFIX = '/halloween-contest';
const ssm = new SSMClient({ region: 'ap-southeast-2' });

async function exists(name: string) {
  try {
    await ssm.send(new GetParameterCommand({ Name: name }));
    return true;
  } catch (e) {
    if (e instanceof ParameterNotFound) return false;
    throw e;
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const passcode = (await rl.question('New admin passcode (min 6 characters): ')).trim();
rl.close();
if (passcode.length < 6) {
  console.error('Passcode must be at least 6 characters.');
  process.exit(1);
}

await ssm.send(new PutParameterCommand({
  Name: `${PREFIX}/admin-passcode-hash`, Value: hashPasscode(passcode), Type: 'SecureString', Overwrite: true,
}));
if (!(await exists(`${PREFIX}/token-secret`))) {
  await ssm.send(new PutParameterCommand({
    Name: `${PREFIX}/token-secret`, Value: randomBytes(32).toString('hex'), Type: 'SecureString',
  }));
  console.log('Created token-signing secret.');
}
console.log('Admin passcode set. It takes effect for new Lambda instances — redeploy or wait a few minutes if you changed it.');
