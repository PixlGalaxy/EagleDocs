import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from 'node:crypto';
import { test } from 'node:test';
import { encryptPayload, generateVapidKeys, isPushEndpoint, vapidHeader } from './webpush.js';

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();

/** The browser's side of RFC 8291: what a real user agent does with the pushed bytes. */
function decryptAsBrowser(body: Buffer, ua: ReturnType<typeof createECDH>, authSecret: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20]!;
  const asPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = ua.computeSecret(asPublic);
  const prkKey = hmac(authSecret, shared);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'last record delimiter');
  return plain.subarray(0, -1).toString();
}

test('a pushed payload decrypts on the browser side', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  const message = JSON.stringify({ title: 'Aprueba Duo', body: 'Tu correo de la universidad', url: '/chat/1' });
  const body = encryptPayload(target, Buffer.from(message));
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(decryptAsBrowser(body, ua, auth), message);
  // A fresh key and salt every time.
  assert.notDeepEqual(encryptPayload(target, Buffer.from(message)).subarray(0, 16), body.subarray(0, 16));
});

test('the VAPID header is an ES256 JWT for the push service origin, signed by our key', () => {
  const keys = generateVapidKeys();
  const header = vapidHeader('https://fcm.googleapis.com/fcm/send/abc', keys, 'mailto:admin@example.edu', Date.UTC(2026, 9, 14));
  const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
  assert.ok(match, header);
  const [, h, c, s, k] = match;
  assert.equal(k, keys.publicKey);
  const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:admin@example.edu');
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url')));
});

test('only real push services are accepted as endpoints', () => {
  for (const ok of [
    'https://fcm.googleapis.com/fcm/send/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://web.push.apple.com/QG',
    'https://wns2-bl2p.notify.windows.com/w/?token=x',
  ]) {
    assert.ok(isPushEndpoint(ok), ok);
  }
  for (const bad of ['http://fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'https://evil.com/fcm.googleapis.com', 'https://fcm.googleapis.com.evil.com/x', 'not a url']) {
    assert.ok(!isPushEndpoint(bad), bad);
  }
  assert.ok(isPushEndpoint('http://localhost:4996/push/1', true), 'development and tests may use a local endpoint');
});
