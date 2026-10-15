import express, { Router } from 'express';
import type { SettingsService } from '../../db/settings.js';
import { badRequest } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAdmin, requireAuth } from '../auth/session.middleware.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { verifyStripeSignature, type BillingService } from './billing.service.js';
import type { TiersService } from './tiers.service.js';

/**
 * Settings → Plan (every user), Admin → Tiers and Billing, and the Stripe
 * webhook. The webhook needs the raw body for its signature, so mount it
 * before express.json and outside CSRF (Stripe cannot send our token).
 */
export function createBillingRoutes(deps: { billing: BillingService; tiers: TiersService; settings: SettingsService }) {
  const { billing, tiers, settings } = deps;
  const user = Router();
  const admin = Router();
  user.use(requireAuth);
  admin.use(requireAdmin);

  user.get('/plan', async (req: AppRequest, res) => res.json(await billing.plan(req.user!.id)));
  user.get('/tiers', async (_req, res) => res.json(await billing.offered()));
  user.post('/checkout', async (req: AppRequest, res) => {
    const tierId = String((req.body as { tierId?: unknown })?.tierId ?? '');
    res.json(await billing.checkout({ id: req.user!.id, email: req.user!.email }, tierId));
  });
  user.post('/portal', async (req: AppRequest, res) => res.json(await billing.portal(req.user!.id)));

  const webhook = Router();
  webhook.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const secret = settings.getSecret(K.stripeWebhookSecret) ?? '';
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!verifyStripeSignature(raw, req.get('stripe-signature'), secret)) {
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }
    let event: { id: string; type: string; data: { object: Record<string, unknown> } };
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    const outcome = await billing.handleEvent(event);
    if (outcome === 'processed') logger.system.info(`Stripe ${event.type} (${event.id})`);
    res.json({ received: true, outcome });
  });

  // ---------------------------------------------------------------- admin
  const billingView = () => ({
    enabled: settings.getBoolean(K.billingEnabled, false),
    stripe_secret_set: settings.hasSecret(K.stripeSecretKey),
    stripe_webhook_secret_set: settings.hasSecret(K.stripeWebhookSecret),
    grace_days: billing.graceDays(),
    webhook_path: '/api/billing/webhook',
  });

  admin.get('/billing', (_req, res) => res.json(billingView()));
  admin.put('/billing', async (req: AppRequest, res) => {
    const body = (req.body ?? {}) as { enabled?: unknown; stripe_secret_key?: unknown; stripe_webhook_secret?: unknown; grace_days?: unknown };
    if (typeof body.stripe_secret_key === 'string' && body.stripe_secret_key.trim()) {
      const key = body.stripe_secret_key.trim();
      if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/.test(key)) throw badRequest('billing.invalidKey');
      await settings.setSecret(K.stripeSecretKey, key);
    }
    if (typeof body.stripe_webhook_secret === 'string' && body.stripe_webhook_secret.trim()) {
      const secret = body.stripe_webhook_secret.trim();
      if (!/^whsec_[A-Za-z0-9]{10,}$/.test(secret)) throw badRequest('billing.invalidKey');
      await settings.setSecret(K.stripeWebhookSecret, secret);
    }
    const updates: Record<string, unknown> = {};
    if (body.grace_days !== undefined) {
      const days = Number(body.grace_days);
      if (!Number.isInteger(days) || days < 0 || days > 30) throw badRequest('tiers.invalidLimit');
      updates[K.billingGraceDays] = days;
    }
    if (body.enabled !== undefined) {
      // Turning billing on needs both keys, or checkout and webhooks would fail later.
      if (body.enabled === true && (!settings.hasSecret(K.stripeSecretKey) || !settings.hasSecret(K.stripeWebhookSecret))) throw badRequest('billing.keysFirst');
      updates[K.billingEnabled] = body.enabled === true;
    }
    if (Object.keys(updates).length) await settings.setMany(updates);
    logger.system.info(`"${req.user!.username}" updated billing settings`);
    res.json(billingView());
  });

  admin.get('/tiers', async (_req, res) => res.json(await tiers.list()));
  admin.post('/tiers', async (req: AppRequest, res) => res.status(201).json(await tiers.create((req.body ?? {}) as Record<string, unknown>)));
  admin.put('/tiers/:id', async (req: AppRequest, res) => res.json(await tiers.update(routeParam(req.params.id), (req.body ?? {}) as Record<string, unknown>)));
  admin.delete('/tiers/:id', async (req: AppRequest, res) => {
    await tiers.remove(routeParam(req.params.id));
    res.status(204).end();
  });

  return { user, admin, webhook };
}
