import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useI18n } from '../../i18n/I18nContext';

const WIDTH_KEY = 'eagledocs.filesPanelWidth';
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 240;
/** The chat keeps at least this much of the window. */
const MAX_SHARE = 0.6;
const STEP = 24;

const maxWidth = () => Math.max(MIN_WIDTH, Math.round(window.innerWidth * MAX_SHARE));
const clamp = (width: number) => Math.min(maxWidth(), Math.max(MIN_WIDTH, Math.round(width)));

function savedWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return value > 0 ? clamp(value) : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

/**
 * A right-side panel the student widens or narrows by dragging its left edge
 * (or with the arrow keys on the handle). Double-click resets it. The width is
 * remembered in this browser.
 */
const ResizableDock = ({ children, className = '' }: { children: ReactNode; className?: string }) => {
  const { t } = useI18n();
  const [width, setWidth] = useState(savedWidth);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);

  const remember = useCallback((value: number) => {
    try {
      localStorage.setItem(WIDTH_KEY, String(value));
    } catch {
      // Private mode or blocked storage: the width just resets next time.
    }
  }, []);

  // A smaller window must never leave the panel wider than its share.
  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    // Dragging left widens a panel that sits on the right.
    setWidth(clamp(start.current.width + start.current.x - e.clientX));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    start.current = null;
    setDragging(false);
    remember(width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = e.key === 'ArrowLeft' ? STEP : e.key === 'ArrowRight' ? -STEP : 0;
    const next = e.key === 'Home' ? MIN_WIDTH : e.key === 'End' ? maxWidth() : delta ? clamp(width + delta) : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
    remember(next);
  };
  const reset = () => {
    const next = clamp(DEFAULT_WIDTH);
    setWidth(next);
    remember(next);
  };

  return (
    <aside style={{ width }} className={`relative shrink-0 ${dragging ? 'select-none' : ''} ${className}`}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('chat.resizeFiles')}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        title={t('chat.resizeFiles')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize justify-center outline-none"
      >
        <span
          className={`h-full w-px transition-colors group-hover:w-0.5 group-hover:bg-[var(--accent-500)] group-focus-visible:w-0.5 group-focus-visible:bg-[var(--accent-500)] ${
            dragging ? 'w-0.5 bg-[var(--accent-500)]' : 'bg-transparent'
          }`}
        />
      </div>
      {children}
    </aside>
  );
};

export default ResizableDock;
