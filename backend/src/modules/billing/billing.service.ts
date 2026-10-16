import { createHmac, timingSafeEqual } from 'crypto';
import type { EnvConfig } from '../../config/env.js';
import type { Db } from '../../db/pool.js';
import { maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import { AppError, badRequest, conflict } from '../../errors.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import type { TierRow, TiersService } from './tiers.service.js';

/** Stripe signs webhooks with a timestamp; older than this is a replay. */
const SIGNATURE_TOLERANCE_S = 300;

interface SubscriptionRow {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string | null;
  tier_id: string | null;
  status: string;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  grace_until: Date | null;
}

/** Stripe's form encoding: nested objects and arrays as `a[b][0][c]=v`. */
export function formEncode(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object') parts.push(formEncode(value as Record<string, unknown>, name));
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
  }
  return parts.filter(Boolean).join('&');
}

/** Checks the `Stripe-Signature` header (t=...,v1=...) against the raw body. Returns false on any doubt. */
export function verifyStripeSignature(rawBody: Buffer, header: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_S || signatures.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return signatures.some((sig) => {
    const given = Buffer.from(sig, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/**
 * Plans for money: Stripe Checkout to subscribe, the Customer Portal to change
 * or cancel, and webhooks that keep `subscriptions` and the student's plan in
 * sync. Off until the admin turns billing on and saves the Stripe keys.
 */
export interface StripeEvent {
  id: string;
  type: string;
  /** Unix seconds. */
  created?: number;
  data: { object: Record<string, unknown> };
}

export class BillingService {
  constructor(
    private db: Db,
    private settings: SettingsService,
    private tiers: TiersService,
    private config: EnvConfig,
    /** Tests point this at a fake Stripe. */
    private apiBase = process.env.STRIPE_API_BASE || 'https://api.stripe.com',
  ) {}

  enabled(): boolean {
    return this.settings.getBoolean(K.billingEnabled, false) && this.settings.hasSecret(K.stripeSecretKey);
  }

  graceDays(): number {
    return Math.min(30, Math.max(0, this.settings.getNumber(K.billingGraceDays, 3)));
  }

  private async stripe<T>(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}): Promise<T> {
    const key = this.settings.getSecret(K.stripeSecretKey);
    if (!key) throw new AppError(503, 'billing.off');
    const body = formEncode(params);
    const res = await fetch(`${this.apiBase}/v1/${path}${method === 'GET' && body ? `?${body}` : ''}`, {
      method,
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-version': '2024-06-20' },
      ...(method === 'POST' && { body }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & T;
    if (!res.ok) {
      // Stripe's own message, never the key.
      logger.warn(`Stripe ${method} ${path} failed (${res.status}): ${json.error?.message ?? 'no message'}`);
      throw new AppError(502, 'billing.stripeFailed');
    }
    return json;
  }

  private subscription(userId: string) {
    return maybe<SubscriptionRow>(this.db, 'SELECT * FROM subscriptions WHERE user_id = $1', [userId]);
  }

  /** Settings → Plan. */
  async plan(userId: string) {
    const limits = await this.tiers.limitsFor(userId);
    const tier = limits.tierId ? await this.tiers.get(limits.tierId) : undefined;
    const sub = await this.subscription(userId);
    const usage = await maybe<{ messages: number; tokens_in: number; tokens_out: number; mcp_calls: number; mcp_code_runs: number }>(
      this.db,
      'SELECT studyhawk_messages AS messages, tokens_in, tokens_out, mcp_calls, mcp_code_runs FROM usage_daily WHERE user_id = $1 AND day = current_date',
      [userId],
    );
    return {
      tier,
      billing_enabled: this.enabled(),
      subscription_status: sub?.stripe_subscription_id ? sub.status : null,
      current_period_end: sub?.current_period_end ?? null,
      cancel_at_period_end: sub?.cancel_at_period_end ?? false,
      grace_until: sub?.grace_until ?? null,
      usage_today: {
        messages: usage?.messages ?? 0,
        tokens_in: Number(usage?.tokens_in ?? 0),
        tokens_out: Number(usage?.tokens_out ?? 0),
        mcp_calls: usage?.mcp_calls ?? 0,
        mcp_code_runs: usage?.mcp_code_runs ?? 0,
      },
    };
  }

  /** Plans a student can pick: enabled ones, with a price when billing is on. */
  async offered(): Promise<TierRow[]> {
    return (await this.tiers.list()).filter((t) => t.enabled && (t.is_default || !this.enabled() || t.stripe_price_id));
  }

  async checkout(user: { id: string; email: string }, tierId: string): Promise<{ url: string }> {
    if (!this.enabled()) throw new AppError(404, 'billing.off');
    const tier = await this.tiers.get(tierId);
    if (!tier?.enabled || !tier.stripe_price_id || tier.price_cents <= 0) throw badRequest('billing.notForSale');
    const existing = await this.subscription(user.id);
    if (existing?.stripe_subscription_id && ['active', 'trialing', 'past_due'].includes(existing.status)) {
      // Changing plans goes through the portal, so Stripe prorates instead of charging twice.
      throw conflict('billing.alreadySubscribed');
    }
    let customer = existing?.stripe_customer_id;
    if (!customer) {
      customer = (await this.stripe<{ id: string }>('POST', 'customers', { email: user.email, metadata: { user_id: user.id } })).id;
      await this.db.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = $2, updated_at = now()`,
        [user.id, customer],
      );
    }
    const back = `${this.config.PUBLIC_URL}/settings?section=plan`;
    const session = await this.stripe<{ url: string }>('POST', 'checkout/sessions', {
      mode: 'subscription',
      customer,
      client_reference_id: user.id,
      line_items: [{ price: tier.stripe_price_id, quantity: 1 }],
      success_url: `${back}&checkout=success`,
      cancel_url: `${back}&checkout=cancel`,
      metadata: { user_id: user.id, tier_id: tier.id },
      subscription_data: { metadata: { user_id: user.id, tier_id: tier.id } },
    });
    return { url: session.url };
  }

  async portal(userId: string): Promise<{ url: string }> {
    if (!this.enabled()) throw new AppError(404, 'billing.off');
    const sub = await this.subscription(userId);
    if (!sub) throw badRequest('billing.noSubscription');
    return this.stripe<{ url: string }>('POST', 'billing_portal/sessions', {
      customer: sub.stripe_customer_id,
      return_url: `${this.config.PUBLIC_URL}/settings?section=plan`,
    });
  }

  /**
   * A Stripe event, already verified. Each event id is processed once, even
   * if it reaches several replicas at the same time.
   */
  async handleEvent(event: StripeEvent): Promise<'processed' | 'duplicate' | 'ignored' | 'stale'> {
    const fresh = await this.db.query('INSERT INTO stripe_events (id, type) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [event.id, event.type]);
    if (!fresh.rowCount) return 'duplicate';
    try {
      return await this.apply(event);
    } catch (err) {
      // Not applied: forget the id so Stripe's retry is processed instead of skipped as a duplicate.
      await this.db.query('DELETE FROM stripe_events WHERE id = $1', [event.id]).catch(() => undefined);
      throw err;
    }
  }

  private async apply(event: StripeEvent): Promise<'processed' | 'ignored' | 'stale'> {
    const obj = event.data.object;
    // When Stripe created it (seconds); an event without one counts as now.
    const at = new Date(typeof event.created === 'number' ? event.created * 1000 : Date.now());
    switch (event.type) {
      case 'checkout.session.completed':
        return this.onCheckout(obj, at);
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        return this.onSubscription(obj, event.type.endsWith('deleted'), at);
      case 'invoice.payment_failed':
        await this.db.query(
          `UPDATE subscriptions SET grace_until = COALESCE(grace_until, now() + make_interval(days => $2)), updated_at = now()
           WHERE stripe_customer_id = $1`,
          [String(obj.customer ?? ''), this.graceDays()],
        );
        return 'processed';
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
        await this.db.query('UPDATE subscriptions SET grace_until = NULL, updated_at = now() WHERE stripe_customer_id = $1', [String(obj.customer ?? '')]);
        return 'processed';
      default:
        return 'ignored';
    }
  }

  private async setPlan(userId: string, tierId: string | null): Promise<void> {
    await this.db.query('UPDATE users SET tier_id = $2, tier_expires_at = NULL WHERE id = $1', [userId, tierId]);
    this.tiers.forget(userId);
  }

  private async onCheckout(session: Record<string, unknown>, at: Date): Promise<'processed' | 'ignored' | 'stale'> {
    const userId = String(session.client_reference_id ?? '');
    const metadata = (session.metadata ?? {}) as Record<string, string>;
    const tier = metadata.tier_id ? await this.tiers.get(metadata.tier_id) : undefined;
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !tier) return 'ignored';
    // Delayed payment methods complete the checkout before the money arrives: the subscription events grant the plan then.
    if (session.payment_status !== undefined && !['paid', 'no_payment_required'].includes(String(session.payment_status))) return 'ignored';
    const { rowCount } = await this.db.query(
      `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, tier_id, status, last_event_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, now())
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = $2, stripe_subscription_id = $3, tier_id = $4, status = 'active',
         grace_until = NULL, last_event_at = $5, updated_at = now()
       WHERE subscriptions.last_event_at IS NULL OR subscriptions.last_event_at <= $5`,
      [userId, String(session.customer ?? ''), String(session.subscription ?? ''), tier.id, at],
    );
    if (!rowCount) return 'stale';
    await this.setPlan(userId, tier.id);
    return 'processed';
  }

  private async onSubscription(sub: Record<string, unknown>, deleted: boolean, at: Date): Promise<'processed' | 'ignored' | 'stale'> {
    const id = String(sub.id ?? '');
    const customer = String(sub.customer ?? '');
    const row = await maybe<SubscriptionRow>(
      this.db,
      'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2 ORDER BY (stripe_subscription_id = $1) DESC LIMIT 1',
      [id, customer],
    );
    if (!row) return 'ignored';
    const items = ((sub.items as { data?: { price?: { id?: string }; current_period_end?: number }[] } | undefined)?.data ?? []);
    const priceId = items[0]?.price?.id;
    const tier = priceId ? await this.tiers.byStripePrice(priceId) : undefined;
    const periodEnd = Number(sub.current_period_end ?? items[0]?.current_period_end ?? 0);
    const status = deleted ? 'canceled' : String(sub.status ?? row.status);
    // Only when nothing newer was applied already: an old retry must not undo a cancellation.
    const { rowCount } = await this.db.query(
      `UPDATE subscriptions SET stripe_subscription_id = $2, status = $3, tier_id = COALESCE($4, tier_id),
         current_period_end = $5, cancel_at_period_end = $6, last_event_at = $7, updated_at = now(),
         grace_until = CASE WHEN $3 IN ('active', 'trialing') THEN NULL ELSE grace_until END
       WHERE user_id = $1 AND (last_event_at IS NULL OR last_event_at <= $7)`,
      [row.user_id, id, status, tier?.id ?? null, periodEnd ? new Date(periodEnd * 1000) : null, sub.cancel_at_period_end === true, at],
    );
    if (!rowCount) return 'stale';
    const paidTier = tier?.id ?? row.tier_id;
    if (['active', 'trialing'].includes(status) && paidTier) await this.setPlan(row.user_id, paidTier);
    // Over: back to the default plan, unless the admin gave them another one meanwhile.
    else if (['canceled', 'incomplete_expired'].includes(status)) await this.dropPaidPlan(row.user_id, paidTier);
    return 'processed';
  }

  private async dropPaidPlan(userId: string, paidTier: string | null): Promise<void> {
    await this.db.query('UPDATE users SET tier_id = NULL, tier_expires_at = NULL WHERE id = $1 AND tier_id IS NOT DISTINCT FROM $2', [userId, paidTier]);
    this.tiers.forget(userId);
  }

  /** Leader task: when a failed payment's grace period ends, the student goes back to the default plan. */
  async expireGrace(): Promise<void> {
    const { rows } = await this.db.query<{ user_id: string; tier_id: string | null }>(
      // A later successful payment (subscription back to active) restores the plan through the webhook.
      `UPDATE subscriptions SET status = CASE WHEN status IN ('active', 'trialing') THEN 'past_due' ELSE status END,
         grace_until = NULL, updated_at = now()
       WHERE grace_until IS NOT NULL AND grace_until < now() RETURNING user_id, tier_id`,
    );
    for (const row of rows) {
      await this.dropPaidPlan(row.user_id, row.tier_id);
      logger.info(`Plan of ${row.user_id} back to the default: the grace period after a failed payment ended`);
    }
  }
}
