import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { Bus } from '../../bus/bus.js';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { maybe, many } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { logger } from '../../logger.js';
import type { BillingService } from '../billing/billing.service.js';
import type { SandboxManager } from '../sandbox/manager.js';

/** Days between asking to delete an account and erasing it; signing in again before that keeps it. */
export const DELETE_AFTER_DAYS = 30;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deleting an account. `request` switches it off at once (sessions, apps, jobs,
 * notifications, sandbox) and cancels the paid plan in Stripe; `purge` erases
 * everything, after the 30 days or at once when an admin deletes the account:
 * the files on disk (workspace, TEMP, browser cookies, avatar) and then the rows,
 * which take the rest with them (ON DELETE CASCADE).
 */
export class AccountDeletion {
  constructor(
    private deps: {
      db: Db;
      bus: Bus;
      config: Pick<EnvConfig, 'DATA_ROOT' | 'AVATARS_DIR'>;
      billing: BillingService;
      sandboxes: SandboxManager;
    },
  ) {}

  /** The owner asked to delete their account. Returns when it will be erased. */
  async request(userId: string): Promise<Date> {
    const { db, billing } = this.deps;
    // First, so a Stripe failure leaves the account as it was and nothing is ever charged again by mistake.
    await billing.cancelNow(userId);
    const deleteAfter = await withTx(db, async (client) => {
      const { rows } = await client.query<{ delete_after: Date }>(
        `UPDATE users SET status = 'deleting', delete_after = now() + make_interval(days => $2), updated_at = now()
          WHERE id = $1 RETURNING delete_after`,
        [userId, DELETE_AFTER_DAYS],
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await client.query('UPDATE oauth_grants SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await client.query('DELETE FROM push_subscriptions WHERE user_id = $1', [userId]);
      await client.query("UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE user_id = $1 AND status = 'queued'", [userId]);
      return rows[0]!.delete_after;
    });
    await this.stopWork(userId);
    logger.info(`Account ${userId} will be deleted on ${deleteAfter.toISOString()} (requested by its owner)`);
    return deleteAfter;
  }

  /** Signed in again within the 30 days: the account is back (the cancelled plan is not). */
  async restore(userId: string): Promise<void> {
    await this.deps.db.query("UPDATE users SET status = 'active', delete_after = NULL, updated_at = now() WHERE id = $1 AND status = 'deleting'", [userId]);
    logger.info(`Account ${userId} restored: its owner signed in before it was deleted`);
  }

  /** Erases the account and everything in it, now. */
  async purge(userId: string): Promise<void> {
    if (!UUID.test(userId)) throw new Error(`Not a user id: ${userId}`);
    const { db, config, billing } = this.deps;
    const user = await maybe<{ avatar_path: string | null }>(db, 'SELECT avatar_path FROM users WHERE id = $1', [userId]);
    if (!user) return;
    // Again, in case it was never cancelled (an admin deleting an active account, or Stripe failed back then).
    await billing.cancelNow(userId);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await this.stopWork(userId);
    await fs.rm(join(config.DATA_ROOT, 'workspaces', userId), { recursive: true, force: true });
    await fs.rm(join(config.DATA_ROOT, 'temp', userId), { recursive: true, force: true });
    if (user.avatar_path && !/[\\/]/.test(user.avatar_path)) {
      await fs.rm(join(config.AVATARS_DIR, user.avatar_path), { force: true });
    }
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    logger.info(`Account ${userId} deleted with all its data`);
  }

  /** Leader task: erases the accounts whose 30 days are over. One that fails is tried again next time. */
  async purgeDue(): Promise<void> {
    const due = await many<{ id: string }>(
      this.deps.db,
      "SELECT id FROM users WHERE status = 'deleting' AND delete_after <= now() ORDER BY delete_after LIMIT 20",
    );
    for (const { id } of due) {
      await this.purge(id).catch((err: Error) => logger.warn(`Account ${id} could not be deleted yet: ${err.message}`));
    }
  }

  /** Stops the user's running work on every replica: their agent jobs and their sandbox. */
  private async stopWork(userId: string): Promise<void> {
    const { db, bus, sandboxes } = this.deps;
    const running = await many<{ id: string }>(db, "SELECT id FROM jobs WHERE user_id = $1 AND status IN ('running', 'waiting_approval', 'waiting_mfa')", [userId]);
    for (const job of running) {
      await db.query('UPDATE jobs SET cancel_requested = true WHERE id = $1', [job.id]);
      await bus.publish('job_control', { jobId: job.id, action: 'cancel' });
    }
    await sandboxes.stop(userId, 'account deleted').catch(() => undefined);
    await bus.publish('sandbox_control', { userId, action: 'stop' });
  }
}
