import { isIP } from 'net';

/**
 * Cloudflare's edge ranges (https://www.cloudflare.com/ips/). Only needed when
 * the site is proxied through Cloudflare (orange cloud): the request then
 * reaches the reverse proxy from one of these addresses, with the visitor's
 * real IP one hop further back in X-Forwarded-For.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

/** Named groups Express understands on its own, plus our `cloudflare` shortcut. */
const PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isAddressOrRange(value: string): boolean {
  const [address, bits, extra] = value.split('/');
  if (extra !== undefined || !isIP(address)) return false;
  if (bits === undefined) return true;
  const max = isIP(address) === 4 ? 32 : 128;
  return /^\d+$/.test(bits) && Number(bits) <= max;
}

/**
 * Turns `TRUST_PROXY` (comma-separated) into the list handed to Express's
 * `trust proxy`. Loopback is always trusted, because the bundled nginx sits in
 * front of the backend on 127.0.0.1. Anything listed here is trusted to report
 * the client's IP in X-Forwarded-For, so only list proxies you control: a
 * trusted address can claim to be any client.
 *
 * Accepted entries: `uniquelocal` (10/8, 172.16/12, 192.168/16, fc00::/7 — the
 * usual choice for Nginx Proxy Manager, Traefik or Caddy on the same host or
 * LAN), `linklocal`, `cloudflare`, or explicit addresses and CIDR ranges.
 * Unknown entries are ignored and reported back, so a typo cannot widen trust.
 */
export function parseTrustProxy(raw: string | undefined): { trusted: string[]; invalid: string[]; setting: string } {
  const trusted = new Set(['loopback']);
  const invalid: string[] = [];
  const accepted: string[] = [];

  for (const entry of (raw ?? '').split(',').map((part) => part.trim()).filter(Boolean)) {
    const lower = entry.toLowerCase();
    if (lower === 'cloudflare') CLOUDFLARE_RANGES.forEach((range) => trusted.add(range));
    else if (PRESETS.has(lower)) trusted.add(lower);
    else if (isAddressOrRange(entry)) trusted.add(entry);
    else {
      invalid.push(entry);
      continue;
    }
    const shown = PRESETS.has(lower) || lower === 'cloudflare' ? lower : entry;
    if (!accepted.includes(shown)) accepted.push(shown);
  }

  // `setting` is the cleaned-up value as an admin would type it (no expanded
  // Cloudflare ranges, no implicit loopback), for showing and storing.
  return { trusted: [...trusted], invalid, setting: accepted.join(', ') };
}
