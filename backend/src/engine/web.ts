import { promises as dns } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import zlib from 'node:zlib';
import type { FetchPort, FetchedPage, SearchHit, SearchPort } from 'pixlai-engine';
import { decodeEntities, SearchChain } from 'pixlai-engine';
import { logger } from '../logger.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 EagleDocs';
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

// ------------------------------------------------------------------ SSRF guard

/** Addresses the agent must never reach: loopback, private networks, link-local (cloud metadata), CGNAT, multicast... */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return isPrivateAddress(mapped);
  const family = isIP(address);
  if (!family) return true;
  return PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

/** Resolves a host and refuses it when any of its addresses is internal. Returns the address to connect to. */
async function publicAddress(hostname: string): Promise<{ address: string; family: number }> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$|\.localhost$|\.local$|\.internal$/i.test(host)) throw new Error('That address is not reachable from EagleDocs');
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await dns.lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) throw new Error('That address is not reachable from EagleDocs');
  return addresses[0]!;
}

/**
 * For addresses a student types (their own model API): refuses internal hosts.
 * Checked when saved and before every request, so a later DNS change cannot
 * point it inside; those requests also refuse redirects.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported');
  await publicAddress(url.hostname);
}

/**
 * The engine's FetchPort: downloads public http(s) URLs only. Every hop of a
 * redirect is resolved and checked, and the connection goes to the address that
 * was checked (no second DNS answer can swap in an internal one).
 */
export class SafeFetch implements FetchPort {
  async fetch(rawUrl: string, options: { maxBytes: number; signal: AbortSignal }): Promise<FetchedPage> {
    let url = new URL(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http and https URLs are supported');
      const target = await publicAddress(url.hostname);
      const res = await this.request(url, target, options);
      if (res.status >= 300 && res.status < 400 && res.location) {
        url = new URL(res.location, url);
        continue;
      }
      return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
    }
    throw new Error('Too many redirects');
  }

  private request(
    url: URL,
    target: { address: string; family: number },
    options: { maxBytes: number; signal: AbortSignal },
  ): Promise<{ status: number; contentType: string; body: Buffer; location?: string }> {
    return new Promise((resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: 'GET',
          headers: {
            'user-agent': USER_AGENT,
            accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,application/json;q=0.9,*/*;q=0.8',
            'accept-encoding': 'gzip, deflate, br',
            'accept-language': 'en-US,en;q=0.9,es;q=0.8',
          },
          // Connect to the vetted address; TLS still checks the certificate against the hostname.
          lookup: (_host, opts, cb) => {
            // Node asks for every address (`all`) when it races IPv4/IPv6; answer with the vetted one either way.
            const done = cb as (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
            if ((opts as { all?: boolean }).all) done(null, [{ address: target.address, family: target.family }]);
            else done(null, target.address, target.family);
          },
          signal: options.signal,
          timeout: TIMEOUT_MS,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400 && res.headers.location) {
            res.resume();
            return resolve({ status, contentType: '', body: Buffer.alloc(0), location: res.headers.location });
          }
          const declared = Number(res.headers['content-length'] ?? 0);
          if (declared > options.maxBytes) {
            res.destroy();
            return reject(new Error(`The file is too large (${Math.round(declared / 1048576)} MB)`));
          }
          const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
          const stream =
            encoding === 'gzip' ? res.pipe(zlib.createGunzip()) : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress()) : encoding === 'deflate' ? res.pipe(zlib.createInflate()) : res;
          const chunks: Buffer[] = [];
          let size = 0;
          stream.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > options.maxBytes) {
              req.destroy(new Error(`The file is too large (over ${Math.round(options.maxBytes / 1048576)} MB)`));
              return;
            }
            chunks.push(chunk);
          });
          stream.on('end', () => resolve({ status, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
          stream.on('error', reject);
        },
      );
      req.on('timeout', () => req.destroy(new Error('The site took too long to answer')));
      req.on('error', reject);
      req.end();
    });
  }
}

// ------------------------------------------------------------------ search

/** SearXNG (self-hosted metasearch: Google, Bing, DuckDuckGo...) with its JSON API enabled. */
export class SearxngSearch implements SearchPort {
  constructor(private baseUrl: string) {}

  async search(query: string, options: { limit: number; language?: string; signal: AbortSignal }): Promise<SearchHit[]> {
    const url = new URL('/search', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('safesearch', '1');
    if (options.language) url.searchParams.set('language', options.language);
    const res = await fetch(url, { signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`SearXNG answered ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? [])
      .filter((r) => r.url && /^https?:/.test(r.url))
      .slice(0, options.limit)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? '' }));
  }
}

/** DuckDuckGo's HTML endpoint: no key, no setup. The fallback when SearXNG is not configured or fails. */
export class DuckDuckGoSearch implements SearchPort {
  async search(query: string, options: { limit: number; signal: AbortSignal }): Promise<SearchHit[]> {
    const res = await fetch('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams({ q: query, kl: 'us-en' }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]),
    });
    if (!res.ok) throw new Error(`DuckDuckGo answered ${res.status}`);
    return parseDuckDuckGo(await res.text()).slice(0, options.limit);
  }
}

const strip = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export function parseDuckDuckGo(html: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const blocks = html.split(/<div[^>]+class="[^"]*\bresult\b[^"]*"/).slice(1);
  for (const block of blocks) {
    if (/result--ad/.test(block.slice(0, 200))) continue;
    const link = /<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;
    let url = decodeEntities(link[1]!);
    // Links go through a redirect: //duckduckgo.com/l/?uddg=<real url>
    const real = /[?&]uddg=([^&]+)/.exec(url)?.[1];
    if (real) url = decodeURIComponent(real);
    if (url.startsWith('//')) url = `https:${url}`;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/.exec(block)?.[1] ?? '';
    hits.push({ title: strip(link[2]!), url, snippet: strip(snippet) });
  }
  return hits;
}

// ------------------------------------------------------------------ paid search APIs (optional, set in Admin)

export const PAID_SEARCH_PROVIDERS = ['brave', 'tavily'] as const;
export type PaidSearchProvider = (typeof PAID_SEARCH_PROVIDERS)[number];

/** Brave Search API: its own index, a free monthly allowance, then paid per query. */
export class BraveSearch implements SearchPort {
  constructor(private apiKey: string) {}

  async search(query: string, options: { limit: number; language?: string; signal: AbortSignal }): Promise<SearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(20, options.limit)));
    url.searchParams.set('safesearch', 'moderate');
    const res = await fetch(url, {
      headers: { accept: 'application/json', 'x-subscription-token': this.apiKey },
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]),
    });
    if (!res.ok) throw new Error(`Brave answered ${res.status}`);
    const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
    return (data.web?.results ?? [])
      .filter((r) => r.url && /^https?:/.test(r.url))
      .slice(0, options.limit)
      .map((r) => ({ title: strip(r.title ?? r.url!), url: r.url!, snippet: strip(r.description ?? '') }));
  }
}

/** Tavily: a search API made for agents (clean snippets of each page). */
export class TavilySearch implements SearchPort {
  constructor(private apiKey: string) {}

  async search(query: string, options: { limit: number; signal: AbortSignal }): Promise<SearchHit[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ query, max_results: Math.min(20, options.limit), search_depth: 'basic' }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]),
    });
    if (!res.ok) throw new Error(`Tavily answered ${res.status}`);
    const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
    return (data.results ?? [])
      .filter((r) => r.url && /^https?:/.test(r.url))
      .slice(0, options.limit)
      .map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? '' }));
  }
}

export function paidSearch(provider: string, apiKey: string | undefined): SearchPort | null {
  if (!apiKey) return null;
  if (provider === 'brave') return new BraveSearch(apiKey);
  if (provider === 'tavily') return new TavilySearch(apiKey);
  return null;
}

// ------------------------------------------------------------------ the last resort: a real browser

/** Read in the page itself (not by regex over HTML): Bing's organic results. */
const BING_RESULTS = `return [...document.querySelectorAll('li.b_algo')].map((li) => {
  const a = li.querySelector('h2 a');
  const p = li.querySelector('.b_caption p, p');
  return a ? { title: (a.textContent || '').trim(), url: a.href, snippet: ((p && p.textContent) || '').trim() } : null;
}).filter(Boolean).slice(0, 20);`;

/** Bing wraps result links as bing.com/ck/a?...&u=a1<base64url of the real address>. */
export function unwrapBingUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (/(^|\.)bing\.com$/.test(url.hostname) && url.pathname.startsWith('/ck/')) {
      const u = url.searchParams.get('u');
      if (!u?.startsWith('a1')) return null;
      return Buffer.from(u.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    }
    return /^https?:$/.test(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Searches with Chromium in the user's own sandbox, where bot checks rarely
 * trigger. Slow (it may start the sandbox), so it comes last in the chain.
 */
export class BrowserSearch implements SearchPort {
  constructor(private runner: (<T>(userId: string, path: string, body: Record<string, unknown>, signal: AbortSignal) => Promise<T>) | undefined) {}

  async search(query: string, options: { limit: number; signal: AbortSignal; userId?: string }): Promise<SearchHit[]> {
    if (!this.runner || !options.userId) throw new Error('No browser here');
    // A tab of its own in the shared reading browser: searches from parallel helpers do not step on each other.
    const page = await this.runner<{ result: { title: string; url: string; snippet: string }[] | null }>(
      options.userId,
      '/browser/read',
      { url: `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en`, script: BING_RESULTS },
      options.signal,
    );
    const hits: SearchHit[] = [];
    for (const r of page.result ?? []) {
      const url = unwrapBingUrl(r.url);
      if (url && /^https?:\/\//.test(url) && !hits.some((h) => h.url === url)) hits.push({ title: r.title.slice(0, 200), url, snippet: r.snippet.slice(0, 400) });
    }
    return hits.slice(0, options.limit);
  }
}

// ------------------------------------------------------------------ the chain

/**
 * EagleDocs' search, cheapest first: SearXNG (when configured), DuckDuckGo, the
 * paid API the admin set (off without a key), and Chromium in the user's
 * sandbox. The engine's SearchChain moves on when one fails or finds nothing.
 */
export function eagledocsSearch(deps: {
  searxngUrl: string | undefined;
  /** The paid provider and key from Admin → Web search; read on every search, so changes apply at once. */
  paid: () => { provider: string; apiKey: string | undefined };
  runner: ConstructorParameters<typeof BrowserSearch>[0];
}): SearchChain {
  const ddg = new DuckDuckGoSearch();
  const searx = deps.searxngUrl ? new SearxngSearch(deps.searxngUrl) : null;
  const browser = new BrowserSearch(deps.runner);
  return new SearchChain(
    [
      ...(searx ? [{ name: 'searxng', search: searx.search.bind(searx) }] : []),
      { name: 'duckduckgo', search: ddg.search.bind(ddg) },
      {
        name: 'paid',
        enabled: () => Boolean(paidSearch(deps.paid().provider, deps.paid().apiKey)),
        search: (query, options) => paidSearch(deps.paid().provider, deps.paid().apiKey)!.search(query, options),
      },
      ...(deps.runner ? [{ name: 'browser', search: browser.search.bind(browser) }] : []),
    ],
    { logger: { info: (m) => logger.info(m), warn: (m) => logger.warn(m), error: (m, d) => logger.error(m, d) } },
  );
}
