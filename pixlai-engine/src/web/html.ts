/**
 * HTML to readable text for the model, without dependencies: keeps headings,
 * paragraphs, lists, table rows and links; drops scripts, styles, navigation
 * and other chrome. Prefers the page's <main>/<article> when it has one.
 */

const NAMED: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
  middot: '·', bull: '•', deg: '°', times: '×', divide: '÷', euro: '€', pound: '£', yen: '¥', cent: '¢',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É',
  Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü', iexcl: '¡', iquest: '¿',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return NAMED[code] ?? whole;
  });
}

/** Drops whole elements, contents included. */
const DROP = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'head', 'nav', 'footer', 'aside', 'form', 'button', 'select'];

function dropElements(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of DROP) out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ');
  // Elements hidden from everyone are hidden from the model too.
  return dropHidden(out);
}

/** Elements hidden from everyone (`hidden` attribute, `aria-hidden="true"`), not classes like "hidden-xs". */
function dropHidden(html: string): string {
  const open = /<([a-z][a-z0-9]*)(\s[^>]*)>/gi;
  const lower = html.toLowerCase();
  let out = '';
  let from = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const attrs = m[2]!;
    const bare = attrs.replace(/"[^"]*"|'[^']*'/g, '""');
    if (!/\shidden(?=[\s=/]|$)/i.test(bare) && !/\saria-hidden\s*=\s*["']true["']/i.test(attrs)) continue;
    const close = lower.indexOf(`</${m[1]!.toLowerCase()}`, open.lastIndex);
    if (close < 0) continue;
    out += html.slice(from, m.index) + ' ';
    from = html.indexOf('>', close) + 1 || html.length;
    open.lastIndex = from;
  }
  return out + html.slice(from);
}

/** The largest <main> or <article>, when the page has one with real content. */
function mainContent(html: string): string {
  let best = '';
  for (const tag of ['main', 'article']) {
    for (const m of html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi'))) {
      if (m[1]!.length > best.length) best = m[1]!;
    }
  }
  const textLength = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').length;
  return best && textLength(best) > 500 ? best : html;
}

function absolute(href: string, base: string | undefined): string | null {
  if (/^(javascript|mailto|tel|data):/i.test(href) || href.startsWith('#')) return null;
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export function htmlToText(html: string, baseUrl?: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? '');
  let body = mainContent(dropElements(html));

  body = body
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_, level: string, inner: string) => `\n\n${'#'.repeat(Number(level))} ${inner}\n\n`)
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi, (_, href: string, inner: string) => {
      const label = inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const url = absolute(decodeEntities(href), baseUrl);
      return label && url && label !== url ? `[${label}](${url})` : label;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(td|th)\s*>/gi, ' | ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main|header|ul|ol|table|tr|blockquote|pre|dl|dt|dd|figure|figcaption|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  const text = decodeEntities(body)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}
