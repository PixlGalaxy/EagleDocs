/**
 * Finding course material by a half-remembered name ("the homework packet",
 * "ch 7 slides", "H7"): word matching that tolerates accents, case, prefixes
 * and letters glued to numbers, ranked by how much of the query a title covers.
 */

/** One thing in a course that can be opened: a file, a page, an assignment or quiz, a link. */
export interface CanvasThing {
  kind: 'file' | 'page' | 'assignment' | 'quiz' | 'discussion' | 'link' | 'module';
  title: string;
  course_id: number;
  course: string;
  /** The module it sits in, when it is in one. */
  module?: string;
  file_id?: number;
  page_url?: string;
  assignment_id?: number;
  url?: string;
}

/** Lowercase words without accents; "H7" and "ch.7" also give "h"/"ch" and "7". */
export function words(text: string): string[] {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const out: string[] = [];
  // "07" and "7" are the same number.
  const num = (w: string) => (/^\d+$/.test(w) ? String(Number(w)) : w);
  for (const w of plain.split(/[^a-z0-9]+/).filter(Boolean)) {
    out.push(num(w));
    // "h7" -> "h", "7"; "hmwk07" -> "hmwk", "7"
    const parts = w.match(/[a-z]+|\d+/g);
    if (parts && parts.length > 1) out.push(...parts.map(num));
  }
  return out;
}

/** Common short forms students write, read as the word they stand for. */
const SHORT: Record<string, string[]> = {
  hw: ['homework'],
  h: ['homework'],
  ch: ['chapter'],
  chap: ['chapter'],
  wk: ['week'],
  mod: ['module'],
  hmwk: ['homework'],
  lec: ['lecture'],
  syl: ['syllabus'],
};

/**
 * How well a title (and its module, weighted less) matches the query: each query
 * word counts when a title word equals it (3), starts with it or contains it (2;
 * numbers must be equal), or is its short form (2). The whole query inside the
 * title adds 4. 0 means no match.
 */
export function score(query: string, title: string, module = ''): number {
  const q = [...new Set(words(query))];
  if (q.length === 0) return 0;
  const t = words(title);
  const m = words(module);
  let total = 0;
  let matched = 0;
  for (const w of q) {
    const inTitle = matchWord(w, t);
    const inModule = inTitle ? 0 : matchWord(w, m) * 0.5;
    if (inTitle || inModule) matched++;
    total += inTitle || inModule;
  }
  if (matched === 0) return 0;
  // Titles that cover the whole query come first.
  total *= matched / q.length;
  const plainQuery = words(query).join(' ');
  if (plainQuery.length > 3 && words(title).join(' ').includes(plainQuery)) total += 4;
  return Math.round(total * 100) / 100;
}

function matchWord(w: string, in_: string[]): number {
  if (in_.includes(w)) return 3;
  const numeric = /^\d+$/.test(w);
  if (!numeric && w.length >= 3 && in_.some((x) => x.startsWith(w) || (x.length >= 4 && x.includes(w)))) return 2;
  // A short form on either side: "hw" finds "Homework", and "homework" finds "hmwk07".
  if (SHORT[w]?.some((long) => in_.includes(long))) return 2;
  if (w.length >= 3 && in_.some((x) => SHORT[x]?.includes(w))) return 2;
  return 0;
}

/** The best matches, at most `limit`, each with its score. */
export function rank(query: string, things: CanvasThing[], limit = 15): (CanvasThing & { score: number })[] {
  return things
    .map((t) => ({ ...t, score: score(query, t.title, t.module) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}

const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export interface Links {
  /** Each linked file with the words of its link ("hmwk07.docx", "Chapter 7 packet"), so the right one opens without guessing. */
  files: { file_id: number; text: string }[];
  pages: { page_url: string; text: string }[];
  assignment_ids: number[];
}

/** Files, pages and assignments an HTML description or page links to, with the text of each link. */
export function linksIn(html: string | null | undefined): Links {
  const body = html ?? '';
  const files = new Map<number, string>();
  const pages = new Map<string, string>();
  for (const a of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = a[1]!;
    const text = plainText(a[2]!).slice(0, 160) || (/title\s*=\s*["']([^"']+)/i.exec(a[0])?.[1] ?? '');
    const file = /\/files\/(\d+)/.exec(href);
    const page = /\/pages\/([^"'?#<\s/]+)/.exec(href);
    if (file && !files.get(Number(file[1]))) files.set(Number(file[1]), text);
    else if (page && !pages.get(decodeURIComponent(page[1]!))) pages.set(decodeURIComponent(page[1]!), text);
  }
  // Links without an <a> (pasted URLs, embeds): ids without words.
  for (const m of body.matchAll(/\/files\/(\d+)/g)) if (!files.has(Number(m[1]))) files.set(Number(m[1]), '');
  for (const m of body.matchAll(/\/pages\/([^"'?#<\s/]+)/g)) if (!pages.has(decodeURIComponent(m[1]!))) pages.set(decodeURIComponent(m[1]!), '');
  const ids = [...new Set([...body.matchAll(/\/assignments\/(\d+)/g)].map((m) => Number(m[1])))].filter((n) => n > 0);
  return {
    files: [...files].filter(([id]) => id > 0).slice(0, 80).map(([file_id, text]) => ({ file_id, text })),
    pages: [...pages].slice(0, 40).map(([page_url, text]) => ({ page_url, text })),
    assignment_ids: ids.slice(0, 30),
  };
}
