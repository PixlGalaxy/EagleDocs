import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from 'crypto';

/** A browser's push subscription (PushSubscription.toJSON()). */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface VapidKeys {
  /** Uncompressed P-256 point, base64url (what the browser's applicationServerKey takes). */
  publicKey: string;
  /** Raw 32-byte private scalar, base64url. */
  privateKey: string;
}

const b64url = (buf: Buffer) => buf.toString('base64url');
const unb64url = (s: string) => Buffer.from(s, 'base64url');

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

/**
 * Encrypts a payload for one subscription (RFC 8291, aes128gcm content
 * coding from RFC 8188): a fresh server key and salt per message, one record.
 */
export function encryptPayload(target: PushTarget, payload: Buffer): Buffer {
  const uaPublic = unb64url(target.keys.p256dh);
  const authSecret = unb64url(target.keys.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Invalid subscription keys');

  const server = createECDH('prime256v1');
  server.generateKeys();
  const asPublic = server.getPublicKey();
  const shared = server.computeSecret(uaPublic);
  const salt = randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02 marks the last (only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, body]);
}

/** The VAPID Authorization header (RFC 8292): an ES256 JWT for the push service's origin. */
export function vapidHeader(endpoint: string, keys: VapidKeys, subject: string, now = Date.now()): string {
  const pub = unb64url(keys.publicKey);
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
  });
  const header = b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/**
 * Push services browsers actually use. Subscriptions come from the browser, so
 * an endpoint anywhere else would let anyone make the server call that URL.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];

export function isPushEndpoint(endpoint: string, allowAny = false): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (allowAny) return url.protocol === 'https:' || url.protocol === 'http:';
  return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname));
}

export interface SendResult {
  status: number;
  /** The subscription is gone (404/410): delete it. */
  gone: boolean;
}

export async function sendPush(
  target: PushTarget,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  options: { ttlSeconds?: number; urgency?: 'normal' | 'high'; topic?: string } = {},
): Promise<SendResult> {
  const res = await fetch(target.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'content-type': 'application/octet-stream',
      'content-encoding': 'aes128gcm',
      ttl: String(options.ttlSeconds ?? 24 * 3600),
      urgency: options.urgency ?? 'normal',
      // Replaces an undelivered push with the same topic (e.g. a second Duo prompt for the same job).
      ...(options.topic && { topic: options.topic.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) }),
      authorization: vapidHeader(target.endpoint, keys, subject),
    },
    body: encryptPayload(target, Buffer.from(JSON.stringify(payload))),
  });
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status, gone: res.status === 404 || res.status === 410 };
}
