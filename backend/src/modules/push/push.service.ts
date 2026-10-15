import type { Db } from '../../db/pool.js';
import { many } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { LOCKS, withAdvisoryLock } from '../../db/tx.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { generateVapidKeys, isPushEndpoint, sendPush, type PushTarget, type VapidKeys } from './webpush.js';

export const PUSH_KINDS = ['mfa_required', 'job_done', 'approval_required', 'broadcast'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** What the service worker shows (frontend/public/sw.js). */
export interface PushMessage {
  kind: PushKind | 'test';
  title: string;
  body: string;
  /** Opened on click, e.g. the chat. */
  url?: string;
  /** Same tag: the new notification replaces the old one on the device. */
  tag?: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Web push for every replica: VAPID keys live in app_settings (the private one encrypted). */
/** Devices (browsers) per student. */
export const MAX_DEVICES = 10;

export class PushService {
  constructor(
    private db: Db,
    private settings: SettingsService,
    /** Development and tests may push to a local endpoint; production only to real push services. */
    private allowAnyEndpoint: boolean,
  ) {}

  /** Creates the VAPID keys on the first start; one replica does it, the others read them. */
  async ensureKeys(): Promise<void> {
    if (this.keys()) return;
    await withAdvisoryLock(this.db, LOCKS.pushKeys, async () => {
      await this.settings.reload();
      if (this.keys()) return;
      await this.store(generateVapidKeys());
      logger.info('Generated the web push (VAPID) keys');
    });
  }

  private async store(keys: VapidKeys): Promise<void> {
    await this.settings.setSecret(K.pushVapidPrivate, keys.privateKey);
    await this.settings.set(K.pushVapidPublic, keys.publicKey);
  }

  private keys(): VapidKeys | null {
    const publicKey = this.settings.getString(K.pushVapidPublic, '');
    const privateKey = this.settings.getSecret(K.pushVapidPrivate);
    return publicKey && privateKey ? { publicKey, privateKey } : null;
  }

  publicKey(): string | null {
    return this.keys()?.publicKey ?? null;
  }

  contactEmail(): string {
    return this.settings.getString(K.pushContactEmail, '') || this.settings.getString(K.smtpFromEmail, '');
  }

  /** New keys invalidate every subscription (they were made for the old public key). */
  async regenerate(): Promise<void> {
    await this.store(generateVapidKeys());
    await this.db.query('DELETE FROM push_subscriptions');
  }

  subscriptions(): Promise<number> {
    return this.db.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM push_subscriptions').then((r) => r.rows[0]?.n ?? 0);
  }

  isValidEndpoint(endpoint: string): boolean {
    return isPushEndpoint(endpoint, this.allowAnyEndpoint);
  }

  async subscribe(userId: string, target: PushTarget, kinds: PushKind[]): Promise<void> {
    // A device that changes hands (another account signs in) moves to the new user.
    await this.db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, kinds) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, kinds = $5`,
      [userId, target.endpoint, target.keys.p256dh, target.keys.auth, kinds],
    );
    // A handful of devices per student: older ones go first (each notification is sent to all of them).
    await this.db.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND id NOT IN
         (SELECT id FROM push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`,
      [userId, MAX_DEVICES],
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  }

  /** Sends to the user's devices that want this kind. Never throws: a push is a courtesy, not part of the work. */
  async notify(userId: string, message: PushMessage, options: { anyKind?: boolean } = {}): Promise<number> {
    // anyKind: the Settings test reaches every device, whatever kinds it picked.
    const rows = await many<SubscriptionRow>(
      this.db,
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1 AND ($3 OR $2 = ANY(kinds))',
      [userId, message.kind, Boolean(options.anyKind)],
    ).catch(() => []);
    return this.deliver(rows, message);
  }

  /** An announcement to everyone, or to one institution's students. */
  async broadcast(institutionId: string | null, message: PushMessage): Promise<number> {
    const rows = await many<SubscriptionRow>(
      this.db,
      `SELECT s.id, s.endpoint, s.p256dh, s.auth FROM push_subscriptions s JOIN users u ON u.id = s.user_id
       WHERE 'broadcast' = ANY(s.kinds) AND u.status = 'active' AND ($1::uuid IS NULL OR u.institution_id = $1)`,
      [institutionId],
    );
    return this.deliver(rows, message);
  }

  private async deliver(rows: SubscriptionRow[], message: PushMessage): Promise<number> {
    const keys = this.keys();
    if (!keys || rows.length === 0) return 0;
    const subject = `mailto:${this.contactEmail() || 'admin@localhost'}`;
    const results = await Promise.all(
      rows.map(async (row) => {
        if (!this.isValidEndpoint(row.endpoint)) return false;
        try {
          const res = await sendPush({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, message, keys, subject, {
            urgency: message.kind === 'mfa_required' ? 'high' : 'normal',
            // A Duo prompt is useless after a few minutes.
            ttlSeconds: message.kind === 'mfa_required' ? 300 : 24 * 3600,
            ...(message.tag && { topic: message.tag }),
          });
          if (res.gone) {
            await this.db.query('DELETE FROM push_subscriptions WHERE id = $1', [row.id]);
            return false;
          }
          if (res.status >= 400) {
            logger.warn(`Push to ${new URL(row.endpoint).host} failed with ${res.status}`);
            return false;
          }
          await this.db.query('UPDATE push_subscriptions SET last_sent_at = now() WHERE id = $1', [row.id]);
          return true;
        } catch (err) {
          logger.warn(`Push to ${new URL(row.endpoint).host} failed: ${(err as Error).message}`);
          return false;
        }
      }),
    );
    return results.filter(Boolean).length;
  }
}
