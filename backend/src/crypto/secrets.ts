import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM for every secret stored in the database (SMTP password, Canvas
 * tokens, SSO passwords, API keys). Layout: [version:1][iv:12][tag:16][ciphertext].
 * The version byte leaves room to rotate MASTER_KEY later without a flag day.
 */
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class Secrets {
  constructor(private key: Buffer) {
    if (key.length !== 32) throw new Error('MASTER_KEY must be 32 bytes');
  }

  encrypt(plain: string): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  /** Throws when the data was tampered with or encrypted under another MASTER_KEY. */
  decrypt(data: Buffer): string {
    if (data[0] !== VERSION) throw new Error(`Unknown secret version ${data[0]}`);
    if (data.length < 1 + IV_BYTES + TAG_BYTES) throw new Error('Secret is truncated');
    const iv = data.subarray(1, 1 + IV_BYTES);
    const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const body = data.subarray(1 + IV_BYTES + TAG_BYTES);
    // A full-length tag only: GCM would otherwise accept a truncated (easier to forge) one.
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }
}
