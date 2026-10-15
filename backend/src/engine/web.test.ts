import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BrowserSearch, eagledocsSearch, isPrivateAddress, paidSearch, parseDuckDuckGo, SafeFetch, unwrapBingUrl } from './web.js';

test('internal addresses are refused, public ones allowed', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.0.150', '169.254.169.254', '100.64.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', 'not-an-ip']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.72.14', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test('SafeFetch refuses internal targets before connecting', async () => {
  const fetcher = new SafeFetch();
  const signal = new AbortController().signal;
  for (const url of ['http://127.0.0.1:4000/api/admin', 'http://localhost/', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://192.168.0.150:11434/api/tags', 'http://intranet.local/']) {
    await assert.rejects(fetcher.fetch(url, { maxBytes: 1000, signal }), /not reachable/, url);
  }
  await assert.rejects(fetcher.fetch('ftp://example.com/x', { maxBytes: 1000, signal }), /Only http and https/);
});

test('DuckDuckGo HTML results are parsed, redirects unwrapped and ads skipped', () => {
  const html = `
    <div class="result results_links results_links_deep web-result result--ad"><a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Ad</a></div>
    <div class="result results_links results_links_deep web-result ">
      <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FFIFO_and_LIFO_accounting&amp;rut=abc">FIFO and <b>LIFO</b> accounting - Wikipedia</a></h2>
      <a class="result__snippet" href="x">FIFO and LIFO are methods used in managing <b>inventory</b> &amp; costs.</a>
    </div>
    <div class="result results_links web-result "><a class="result__a" href="https://www.investopedia.com/fifo">FIFO definition</a><div class="result__snippet">First in, first out.</div></div>`;
  assert.deepEqual(parseDuckDuckGo(html), [
    { title: 'FIFO and LIFO accounting - Wikipedia', url: 'https://en.wikipedia.org/wiki/FIFO_and_LIFO_accounting', snippet: 'FIFO and LIFO are methods used in managing inventory & costs.' },
    { title: 'FIFO definition', url: 'https://www.investopedia.com/fifo', snippet: 'First in, first out.' },
  ]);
});

test('Bing result links are unwrapped to the real address', () => {
  const real = 'https://www.fgcu.edu/academics/academiccalendar/';
  const wrapped = `https://www.bing.com/ck/a?!&&p=abc&u=a1${Buffer.from(real).toString('base64url')}&ntb=1`;
  assert.equal(unwrapBingUrl(wrapped), real);
  assert.equal(unwrapBingUrl('https://example.com/page'), 'https://example.com/page');
  assert.equal(unwrapBingUrl('https://www.bing.com/ck/a?u=zz'), null);
  assert.equal(unwrapBingUrl('javascript:alert(1)'), null);
});

test('the paid search API is off without a key or with an unknown provider', () => {
  assert.equal(paidSearch('brave', undefined), null);
  assert.equal(paidSearch('none', 'key-123'), null);
  assert.ok(paidSearch('brave', 'key-123'));
  assert.ok(paidSearch('tavily', 'key-123'));
});

test('browser search reads Bing in the user\'s sandbox and always closes its profile', async () => {
  const calls: string[] = [];
  const runner = async <T>(_user: string, path: string): Promise<T> => {
    calls.push(path);
    if (path === '/browser/eval') {
      const wrapped = `https://www.bing.com/ck/a?u=a1${Buffer.from('https://real.example/a').toString('base64url')}`;
      return { result: [{ title: 'A', url: wrapped, snippet: 'about a' }, { title: 'dup', url: 'https://real.example/a', snippet: '' }, { title: 'B', url: 'https://b.example/', snippet: '' }] } as T;
    }
    return {} as T;
  };
  const hits = await new BrowserSearch(runner).search('q', { limit: 5, signal: AbortSignal.timeout(5000), userId: 'u1' });
  assert.deepEqual(hits.map((h) => h.url), ['https://real.example/a', 'https://b.example/']);
  assert.deepEqual(calls, ['/browser/goto', '/browser/eval', '/browser/close']);
  await assert.rejects(new BrowserSearch(undefined).search('q', { limit: 5, signal: AbortSignal.timeout(5000), userId: 'u1' }), /No browser/);
});

test('the chain has the browser last and the paid API only with a key', async () => {
  const withBrowser = eagledocsSearch({ searxngUrl: 'http://searx.invalid', paid: () => ({ provider: 'none', apiKey: undefined }), runner: async <T>() => ({}) as T });
  const names = (withBrowser as unknown as { providers: { name: string }[] }).providers.map((p) => p.name);
  assert.deepEqual(names, ['searxng', 'duckduckgo', 'paid', 'browser']);
  const bare = eagledocsSearch({ searxngUrl: undefined, paid: () => ({ provider: 'none', apiKey: undefined }), runner: undefined });
  assert.deepEqual((bare as unknown as { providers: { name: string }[] }).providers.map((p) => p.name), ['duckduckgo', 'paid']);
});
