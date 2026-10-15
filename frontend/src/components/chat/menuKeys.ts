import type { KeyboardEvent } from 'react';

/** Moves focus between a menu's items with the arrow keys, Home and End. */
export function menuKeys(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="option"], [role="menuitemradio"], a[href]'));
  if (!items.length) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const next =
    e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
  items[next].focus();
}
