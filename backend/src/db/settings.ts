import type { Db } from './pool.js';
import type { Bus } from '../bus/bus.js';
import type { Secrets } from '../crypto/secrets.js';
import { logger } from '../logger.js';

interface Row {
  key: string;
  value: unknown;
  secret_enc: Buffer | null;
}

/** Safety net in case a NOTIFY is lost (bus reconnecting). */
const REFRESH_MS = 30_000;

/**
 * Admin-editable configuration in `app_settings`, layered over the `.env`
 * defaults. Every replica keeps the whole table in memory (it is small) so
 * reads are synchronous; a write NOTIFYs `settings_changed` and every replica
 * reloads. A missing key means "use the default".
 */
export class SettingsService {
  private values = new Map<string, unknown>();
  private secrets = new Map<string, Buffer>();

  constructor(private db: Db, private bus: Bus, private crypto: Secrets) {}

  async start(): Promise<void> {
    await this.reload();
    await this.bus.on('settings_changed', () => void this.reload());
    setInterval(() => void this.reload(), REFRESH_MS).unref();
  }

  async reload(): Promise<void> {
    try {
      const { rows } = await this.db.query<Row>('SELECT key, value, secret_enc FROM app_settings');
      const values = new Map<string, unknown>();
      const secrets = new Map<string, Buffer>();
      for (const row of rows) {
        if (row.value !== null) values.set(row.key, row.value);
        if (row.secret_enc) secrets.set(row.key, row.secret_enc);
      }
      this.values = values;
      this.secrets = secrets;
    } catch (err) {
      logger.warn(`Could not reload settings: ${(err as Error).message}`);
    }
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  getString(key: string, fallback: string): string {
    const value = this.values.get(key);
    return typeof value === 'string' ? value : fallback;
  }

  getNumber(key: string, fallback: number): number {
    const value = this.values.get(key);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const value = this.values.get(key);
    return typeof value === 'boolean' ? value : fallback;
  }

  getJson<T>(key: string, fallback: T): T {
    return this.values.has(key) ? (this.values.get(key) as T) : fallback;
  }

  hasSecret(key: string): boolean {
    return this.secrets.has(key);
  }

  /** Decrypted secret, or undefined when unset or unreadable (wrong MASTER_KEY). */
  getSecret(key: string): string | undefined {
    const data = this.secrets.get(key);
    if (!data) return undefined;
    try {
      return this.crypto.decrypt(data);
    } catch (err) {
      logger.error(`Could not decrypt setting ${key}`, err);
      return undefined;
    }
  }

  /** Writes several plain values at once and tells every replica. */
  async setMany(entries: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(entries);
    if (keys.length === 0) return;
    for (const key of keys) {
      await this.db.query(
        `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
        [key, JSON.stringify(entries[key])],
      );
    }
    await this.changed();
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.setMany({ [key]: value });
  }

  /** Stores an encrypted secret; an empty string clears it. */
  async setSecret(key: string, plain: string): Promise<void> {
    if (plain === '') {
      await this.db.query('UPDATE app_settings SET secret_enc = NULL, updated_at = now() WHERE key = $1', [key]);
    } else {
      await this.db.query(
        `INSERT INTO app_settings (key, secret_enc, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET secret_enc = excluded.secret_enc, updated_at = now()`,
        [key, this.crypto.encrypt(plain)],
      );
    }
    await this.changed();
  }

  async delete(key: string): Promise<void> {
    await this.db.query('DELETE FROM app_settings WHERE key = $1', [key]);
    await this.changed();
  }

  private async changed(): Promise<void> {
    // Reload here right away so the request that saved sees its own write.
    await this.reload();
    await this.bus.publish('settings_changed', {});
  }
}

/**
 * Fails startup when this replica's MASTER_KEY differs from the one the
 * database was set up with: otherwise it would silently fail to read every
 * stored secret.
 */
export async function verifyMasterKey(db: Db, crypto: Secrets): Promise<void> {
  const KEY = 'master_key_check';
  const EXPECTED = 'eagledocs';
  const { rows } = await db.query<{ secret_enc: Buffer | null }>('SELECT secret_enc FROM app_settings WHERE key = $1', [KEY]);
  const stored = rows[0]?.secret_enc;
  if (!stored) {
    await db.query(
      'INSERT INTO app_settings (key, secret_enc) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [KEY, crypto.encrypt(EXPECTED)],
    );
    return;
  }
  let ok = false;
  try {
    ok = crypto.decrypt(stored) === EXPECTED;
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new Error('MASTER_KEY does not match the one this database was created with. Every replica must use the same key.');
  }
}
