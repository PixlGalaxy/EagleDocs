import { useEffect, useState } from 'react';

/** Frames between visible updates: ~30 per second is smooth and keeps markdown re-renders cheap. */
const FRAME_MS = 33;
/** The backlog is drained in about this many frames, so bursts never leave the text far behind. */
const CATCH_UP_FRAMES = 6;

/**
 * Streamed text arrives in bursts (the server batches deltas); this reveals it
 * at an even pace instead, speeding up when a lot is waiting. When `active` is
 * false (a finished message) the full text shows at once.
 */
export function useSmoothText(target: string, active: boolean): string {
  const [shown, setShown] = useState('');
  // A reset (a correction, a new answer) starts over instead of animating backwards.
  const base = target.startsWith(shown) ? shown : '';
  if (active && base !== shown) setShown(base);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = 0;
    let caughtUp = false;
    const step = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        setShown((prev) => {
          const from = target.startsWith(prev) ? prev : '';
          if (from.length >= target.length) {
            caughtUp = true;
            return from;
          }
          return target.slice(0, from.length + Math.max(2, Math.ceil((target.length - from.length) / CATCH_UP_FRAMES)));
        });
      }
      if (!caughtUp) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active]);

  return active ? base : target;
}
