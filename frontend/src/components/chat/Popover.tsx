import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  /** The element the popover hangs from (its trigger). */
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Which edge lines up with the trigger: its left (`start`) or its right (`end`). */
  align?: 'start' | 'end';
  /** A tooltip: no pointer events, no outside-click or keyboard handling. */
  passive?: boolean;
  className?: string;
  id?: string;
  role?: string;
  'aria-label'?: string;
}

const GAP = 6;
/** Keeps the popover off the screen edges (the page's 16px gutter on phones). */
const MARGIN = 12;

/**
 * A floating panel rendered into document.body, so no stacking context in the
 * page (the blurred header, the scrolling conversation) can paint over it. It
 * opens below its trigger when there is room and flips above when there is not,
 * which is the usual case for the composer at the bottom of the screen.
 */
const Popover = ({ anchor, open, onClose, children, align = 'start', passive, className = '', id, role, 'aria-label': ariaLabel }: Props) => {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Positioned straight on the element before paint (no state, no flash), and again on resize or scroll.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = panel.current;
      const trigger = anchor.current;
      if (!el || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      el.style.maxHeight = '';
      const natural = el.scrollHeight;
      const below = vh - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const up = natural > below && above > below;
      if (up) {
        el.style.top = '';
        el.style.bottom = `${vh - rect.top + GAP}px`;
        el.style.maxHeight = `${Math.max(120, above)}px`;
      } else {
        el.style.bottom = '';
        el.style.top = `${rect.bottom + GAP}px`;
        el.style.maxHeight = `${Math.max(120, below)}px`;
      }
      const width = el.offsetWidth;
      const preferred = align === 'end' ? rect.right - width : rect.left;
      el.style.left = `${Math.max(MARGIN, Math.min(preferred, vw - width - MARGIN))}px`;
      el.dataset.side = up ? 'top' : 'bottom';
    };
    place();
    window.addEventListener('resize', place);
    // Capture: any scrolling ancestor (the conversation, a drawer) moves the trigger.
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
    };
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open || passive) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (!!panel.current?.contains(target) || !!anchor.current?.contains(target));
    const onPointer = (e: PointerEvent) => {
      if (!inside(e.target)) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Only this popover closes, not a drawer or dialog underneath.
      e.stopImmediatePropagation();
      closeRef.current();
      anchor.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, passive, anchor]);

  if (!open) return null;

  return createPortal(
    <div
      ref={panel}
      id={id}
      role={role}
      aria-label={ariaLabel}
      style={{ position: 'fixed', top: 0, left: 0 }}
      className={`z-[60] ${passive ? 'pointer-events-none' : 'scroll-thin overflow-y-auto overscroll-contain'} ${className}`}
      onKeyDown={
        passive
          ? undefined
          : (e) => {
              // Tab leaves the menu back at its trigger: the portal sits at the end of the page.
              if (e.key === 'Tab') {
                e.preventDefault();
                closeRef.current();
                anchor.current?.focus();
              }
            }
      }
    >
      {children}
    </div>,
    document.body,
  );
};

export default Popover;
