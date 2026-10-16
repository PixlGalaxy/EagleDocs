/**
 * Runs inside the page (page.evaluate). Turns the visible DOM into an outline
 * for the model, in reading order: headings, text, list items, links and form
 * controls. Every element the agent can use gets `data-hawk-ref="eN"` and is
 * shown as [@eN], so the runner can click or type on it later.
 */
export function pageOutline(maxChars) {
  const INLINE = new Set(['b', 'i', 'em', 'strong', 'span', 'small', 'code', 'sup', 'sub', 'u', 'mark', 'abbr', 'time', 'cite', 'q', 'kbd', 'var', 'label', 'font', 's', 'del', 'ins', 'bdi', 'bdo', 'wbr']);
  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'meta', 'link', 'canvas']);
  const lines = [];
  let size = 0;
  let buffer = '';
  let n = 0;
  let full = false;

  for (const el of document.querySelectorAll('[data-hawk-ref]')) el.removeAttribute('data-hawk-ref');

  const clip = (s, max = 120) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  };
  const push = (line) => {
    if (full || !line) return;
    lines.push(line);
    size += line.length + 1;
    if (size > maxChars) full = true;
  };
  const flush = () => {
    const t = clip(buffer, 800);
    buffer = '';
    push(t);
  };
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || style.display === 'contents';
  };
  const textOf = (el) => clip(el.innerText || el.textContent || '');
  const labelOf = (el) => {
    const byId = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return clip(
      el.getAttribute('aria-label') ||
        (byId && byId.innerText) ||
        (el.closest('label') && el.closest('label').innerText) ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title') ||
        el.getAttribute('name') ||
        '',
    );
  };
  const ref = (el) => {
    const id = `e${++n}`;
    el.setAttribute('data-hawk-ref', id);
    return `[@${id}]`;
  };

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (full) return;
      if (child.nodeType === Node.TEXT_NODE) {
        buffer += child.textContent;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child;
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag) || !visible(el)) continue;
      const role = el.getAttribute('role');

      if (/^h[1-6]$/.test(tag) || role === 'heading') {
        flush();
        push(`${'#'.repeat(Number(tag[1]) || 2)} ${textOf(el)}`);
        continue;
      }
      if (tag === 'a' && el.getAttribute('href')) {
        const label = textOf(el) || labelOf(el) || clip(el.querySelector('img')?.getAttribute('alt') ?? '');
        buffer += ` link "${label}" ${ref(el)}(${clip(el.href, 160)}) `;
        continue;
      }
      if (tag === 'button' || ['button', 'link', 'tab', 'menuitem', 'option', 'switch', 'checkbox', 'radio'].includes(role ?? '') || (tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(el.type))) {
        flush();
        const checked = el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-selected') === 'true' ? ' (selected)' : '';
        push(`${role || 'button'} "${textOf(el) || el.value || labelOf(el)}"${checked} ${ref(el)}`);
        continue;
      }
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
        const type = tag === 'textarea' ? 'textarea' : el.isContentEditable && tag !== 'input' ? 'editor' : el.type;
        if (type === 'hidden') continue;
        flush();
        if (type === 'checkbox' || type === 'radio') {
          push(`${type} "${labelOf(el)}" ${el.checked ? '[x]' : '[ ]'} ${ref(el)}`);
          continue;
        }
        const value = type === 'password' ? (el.value ? ' (filled)' : '') : el.value ? ` value="${clip(el.value, 80)}"` : '';
        push(`textbox "${labelOf(el)}"${type === 'password' ? ' (password)' : ''}${value} ${ref(el)}`);
        continue;
      }
      if (tag === 'select') {
        flush();
        const options = [...el.options].slice(0, 25).map((o) => clip(o.text, 40)).join(' | ');
        push(`select "${labelOf(el)}" = "${clip(el.options[el.selectedIndex]?.text ?? '', 60)}" ${ref(el)} options: ${options}`);
        continue;
      }
      if (tag === 'img') {
        const alt = el.getAttribute('alt');
        if (alt) buffer += ` [image: ${clip(alt, 80)}] `;
        continue;
      }
      if (tag === 'iframe') {
        flush();
        push(`[frame: ${clip(el.title || el.src, 120)}]`);
        continue;
      }
      if (tag === 'br') {
        buffer += ' ';
        continue;
      }
      if (INLINE.has(tag)) {
        walk(el);
        continue;
      }
      if (tag === 'td' || tag === 'th') {
        // Cells stay on their row's line: "Debit | Credit |".
        walk(el);
        buffer += ' | ';
        continue;
      }
      // Block element: its own lines.
      flush();
      if (tag === 'li') buffer = '- ';
      walk(el);
      flush();
    }
  };

  walk(document.body ?? document.documentElement);
  flush();
  return { text: lines.join('\n'), truncated: full, refs: n };
}
