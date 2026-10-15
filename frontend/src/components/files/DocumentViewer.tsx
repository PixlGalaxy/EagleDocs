import { useEffect, useRef, useState } from 'react';
import { renderAsync } from 'docx-preview';
import { Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * docx-preview copies hyperlink targets straight from the document, so a
 * crafted .docx could carry a `javascript:` link that runs in this app's origin
 * when clicked. Anything that is not a plain web/mail link or an in-document
 * anchor loses its href.
 */
function neutralizeUnsafeLinks(root: HTMLElement): void {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = link.getAttribute('href') ?? '';
    if (href.startsWith('#')) continue;
    let protocol = '';
    try {
      protocol = new URL(href, window.location.href).protocol;
    } catch {
      // Unparseable: treated as unsafe below.
    }
    if (SAFE_LINK_PROTOCOLS.has(protocol)) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } else {
      link.removeAttribute('href');
    }
  }
}

interface Props {
  blob: Blob;
  /** The hover card: pages shrunk to fit, no scrolling. */
  compact?: boolean;
}

/** A .docx rendered as HTML pages that look like the original. */
const DocumentViewer = ({ blob, compact = false }: Props) => {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ blob: Blob; error: string } | null>(null);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    // A fresh target per render, so a render still finishing after cleanup can never land next to the new one.
    const target = document.createElement('div');
    host.appendChild(target);
    let cancelled = false;

    renderAsync(blob, target, undefined, {
      ignoreFonts: true,
      renderFooters: false,
      renderFootnotes: false,
      renderEndnotes: false,
      breakPages: !compact,
    })
      .then(() => {
        if (cancelled) return;
        neutralizeUnsafeLinks(target);
        setState({ blob, error: '' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A .docx is a zip; this message means the bytes aren't one at all, almost always an old .doc renamed.
        const notAZip = err instanceof Error && /zip/i.test(err.message);
        setState({ blob, error: t(notAZip ? 'chat.previewNotOfficeFormat' : 'chat.previewError') });
      });

    return () => {
      cancelled = true;
      target.remove();
    };
  }, [blob, compact, t]);

  const done = state?.blob === blob ? state : null;

  return (
    <div className={compact ? 'h-full overflow-hidden bg-slate-200 dark:bg-slate-950' : 'h-full overflow-auto bg-slate-200 dark:bg-slate-950'}>
      {!done && (
        <div className="flex h-full items-center justify-center">
          <Loader2 size={22} className="animate-spin text-slate-400 motion-reduce:animate-none" aria-hidden="true" />
        </div>
      )}
      {done?.error && <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{done.error}</p>}
      {/* docx-preview writes its own page elements (and their styles) in here. */}
      <div ref={container} className={`${compact ? '[zoom:0.4]' : ''} ${!done || done.error ? 'hidden' : ''}`} />
    </div>
  );
};

export default DocumentViewer;
