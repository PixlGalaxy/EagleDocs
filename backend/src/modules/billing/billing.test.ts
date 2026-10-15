import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { formEncode, verifyStripeSignature } from './billing.service.js';

const sign = (body: string, secret: string, t: number) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

test('webhook signatures: right secret and fresh timestamp only', () => {
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  const now = 1_800_000_000;
  const raw = Buffer.from(body);
  assert.ok(verifyStripeSignature(raw, sign(body, 'whsec_test', now), 'whsec_test', now));
  assert.ok(verifyStripeSignature(raw, `${sign(body, 'old_secret', now)},v1=${sign(body, 'whsec_test', now).split('v1=')[1]}`, 'whsec_test', now), 'any of several v1 signatures');
  assert.ok(!verifyStripeSignature(raw, sign(body, 'whsec_other', now), 'whsec_test', now), 'wrong secret');
  assert.ok(!verifyStripeSignature(Buffer.from(body.replace('paid', 'failed')), sign(body, 'whsec_test', now), 'whsec_test', now), 'tampered body');
  assert.ok(!verifyStripeSignature(raw, sign(body, 'whsec_test', now - 600), 'whsec_test', now), 'replayed (too old)');
  assert.ok(!verifyStripeSignature(raw, undefined, 'whsec_test', now));
  assert.ok(!verifyStripeSignature(raw, 't=abc,v1=zz', 'whsec_test', now));
  assert.ok(!verifyStripeSignature(raw, sign(body, '', now), '', now), 'no secret configured');
});

test('Stripe form encoding nests objects and arrays', () => {
  assert.equal(
    formEncode({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 1 }], metadata: { user_id: 'u 1' }, skip: undefined }),
    'mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Buser_id%5D=u%201',
  );
});
