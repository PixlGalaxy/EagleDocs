import { useEffect, useState } from 'react';
import type { PluggableList } from 'unified';

/**
 * Math in answers, with KaTeX. Models write it as \( \), \[ \] or $$ $$; a
 * single $ is never math, because students write amounts ("$50 and $60").
 * KaTeX (with its fonts and CSS) loads only once an answer has a formula.
 */

/** Text outside code: fenced blocks and inline `code` keep their backslashes and dollars. */
const CODE = /(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g;

/** \[ … \] becomes a $$ block and \( … \) inline $$ … $$, the only math remark-math reads here. */
export function normalizeMath(text: string): string {
  if (!text.includes('\\(') && !text.includes('\\[')) return text;
  return text
    .split(CODE)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, tex: string) => `\n$$\n${tex.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, tex: string) => `$$${tex.trim()}$$`),
    )
    .join('');
}

const MATH = /\$\$|\\\(|\\\[/;

let plugins: { remark: PluggableList; rehype: PluggableList } | null = null;
let loading: Promise<void> | null = null;

function loadMath(): Promise<void> {
  loading ??= Promise.all([import('remark-math'), import('rehype-katex'), import('katex/dist/katex.min.css')]).then(([math, katex]) => {
    plugins = {
      remark: [[math.default, { singleDollarTextMath: false }]],
      // A formula still arriving (or written wrong) shows as its source instead of breaking the answer.
      rehype: [[katex.default, { throwOnError: false, strict: false, errorColor: 'inherit' }]],
    };
  });
  return loading;
}

/** The remark and rehype plugins for this text: none until it has math, then KaTeX's once loaded. */
export function useMathPlugins(text: string): { remark: PluggableList; rehype: PluggableList } {
  const needed = MATH.test(text);
  const [, setLoaded] = useState(plugins !== null);
  useEffect(() => {
    if (needed && !plugins) void loadMath().then(() => setLoaded(true));
  }, [needed]);
  return needed && plugins ? plugins : { remark: [], rehype: [] };
}
