import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const prefix = 'xenc:v1:';
function key() {
  const value = process.env.X_TOKEN_ENCRYPTION_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) throw new Error('X token encryption is not configured.');
  return Buffer.from(value, 'hex');
}
export function encryptionKeyId() { return createHash('sha256').update(key()).digest('hex').slice(0, 16); }
export function tokenContext(table: string, id: string | number, field: 'access_token' | 'refresh_token') {
  return `lumenless:x-token:v1:${table}:${id}:${field}`;
}
export function encryptToken(value: string, context: string) {
  if (!value || typeof value !== 'string') throw new Error('Invalid X token.');
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${prefix}${encryptionKeyId()}:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url')}`;
}
export function decryptToken(value: string, context: string) {
  key();
  if (typeof value !== 'string' || !value) throw new Error('Invalid X token.');
  if (!value.startsWith(prefix)) throw new Error('Unencrypted X credentials are not accepted.');
  try {
    if (!value.startsWith(prefix)) throw new Error();
    const [id, payload, extra] = value.slice(prefix.length).split(':');
    if (id !== encryptionKeyId() || !payload || extra) throw new Error();
    const raw = Buffer.from(payload, 'base64url');
    if (raw.length < 29) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new Error('Could not decrypt X credentials.'); }
}
