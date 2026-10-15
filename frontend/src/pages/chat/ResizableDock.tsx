import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

/** The chat always keeps at least this width, whatever panels are open beside it. */
const CHAT_MIN_WIDTH = 560;
/** A panel never takes more than this share of the row it sits in. */
const MAX_SHARE = 0.6;
const STEP = 24;

interface Props {
  children: ReactNode;
  className?: string;
  /** Where the panel sits: its resize handle is on the edge that faces the chat. */
  side: 'left' | 'right';
  /** Where this browser remembers its width. */
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  /** Never wider than this, even with room to spare. */
  maxWidth: number;
  /** For the handle (screen readers and the tooltip). */
  label: string;
}

function saved(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key));
    return value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A side panel next to the chat that the student widens or narrows by dragging
 * the edge facing the chat (or with the arrow keys on the handle); double-click
 * resets it. Its limits come from what is really there: the chat beside it (the
 * row's `[data-chat-column]`) keeps at least CHAT_MIN_WIDTH even with a panel on
 * each side, so neither the panels nor the chat get squeezed out of shape.
 */
const ResizableDock = ({ children, className = '', side, storageKey, defaultWidth, minWidth, maxWidth, label }: Props) => {
  const [width, setWidth] = useState(() => Math.min(maxWidth, Math.max(minWidth, saved(storageKey, defaultWidth))));
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; width: number } | null>(null);
  const self = useRef<HTMLElement>(null);

  /** The widest this panel may be now, if it were `current` wide: what the chat can spare, its share, its cap. */
  const limitFor = useCallback(
    (current: number) => {
      const row = self.current?.parentElement;
      if (!row) return maxWidth;
      const chat = row.querySelector<HTMLElement>(':scope > [data-chat-column]');
      const spare = chat ? current + chat.clientWidth - CHAT_MIN_WIDTH : Infinity;
      return Math.max(minWidth, Math.round(Math.min(maxWidth, row.clientWidth * MAX_SHARE, spare)));
    },
    [maxWidth, minWidth],
  );
  const fit = useCallback((value: number, current: number) => Math.min(limitFor(current), Math.max(minWidth, Math.round(value))), [limitFor, minWidth]);

  const remember = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(storageKey, String(value));
      } catch {
        // Private mode or blocked storage: the width just resets next time.
      }
    },
    [storageKey],
  );

  // Less room (a smaller window, the other panel opening or growing) must never squeeze the chat below its minimum.
  useEffect(() => {
    const row = self.current?.parentElement;
    if (!row) return;
    const observer = new ResizeObserver(() => setWidth((w) => fit(w, w)));
    observer.observe(row);
    const chat = row.querySelector<HTMLElement>(':scope > [data-chat-column]');
    if (chat) observer.observe(chat);
    return () => observer.disconnect();
  }, [fit]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, width };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    // Dragging away from the chat widens the panel: right for a left panel, left for a right one.
    const moved = e.clientX - start.current.x;
    setWidth(fit(start.current.width + (side === 'left' ? moved : -moved), width));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    start.current = null;
    setDragging(false);
    remember(width);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const delta = e.key === grow ? STEP : e.key === shrink ? -STEP : 0;
    const next = e.key === 'Home' ? minWidth : e.key === 'End' ? limitFor(width) : delta ? fit(width + delta, width) : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
    remember(next);
  };
  const reset = () => {
    const next = fit(defaultWidth, width);
    setWidth(next);
    remember(next);
  };

  return (
    <aside ref={self} style={{ width }} className={`relative shrink-0 ${dragging ? 'select-none' : ''} ${className}`}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        title={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={reset}
        onKeyDown={onKeyDown}
        className={`group absolute inset-y-0 z-10 flex w-3 cursor-col-resize justify-center outline-none ${side === 'left' ? '-right-1.5' : '-left-1.5'}`}
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
