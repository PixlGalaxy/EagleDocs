import { useId, useRef, useState } from 'react';
import type { ContextUsage } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Popover from './Popover';

/** Where the engine starts summarizing older messages on its own. */
const AUTO_COMPACT = 0.75;
const RADIUS = 9.75;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** 28734 -> "28.7k", 272000 -> "272.0k", 1_200_000 -> "1.2M". */
function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface Props {
  usage: ContextUsage;
  /** Asks to compact the conversation now. */
  onCompact: () => void;
  /** A run is active: compacting waits until it ends. */
  busy?: boolean;
  compacting?: boolean;
}

/**
 * How full the model's context window is, as a small ring with the percentage
 * inside: accent, amber from 60%, red from 75% (where the engine compacts on
 * its own). Hover or focus shows the details; a click offers to compact now.
 */
const ContextRing = ({ usage, onCompact, busy, compacting }: Props) => {
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const tipId = useId();
  if (!usage.window) return null;

  const ratio = Math.min(1, Math.max(0, usage.used / usage.window));
  const percent = Math.round(ratio * 100);
  const tone = ratio >= AUTO_COMPACT ? 'text-rose-500' : ratio >= 0.6 ? 'text-amber-500' : 'text-[var(--accent-500)]';
  const locked = busy || compacting;

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => {
          if (locked) return;
          // The confirm dialog takes over; the card would otherwise float above it.
          setHover(false);
          setFocus(false);
          onCompact();
        }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        aria-disabled={locked || undefined}
        aria-describedby={tipId}
        aria-label={t('chat.contextRingLabel', { percent })}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]/50 ${
          locked ? 'cursor-default' : 'hover:bg-slate-100 dark:hover:bg-slate-800'
        }`}
      >
        <svg viewBox="0 0 24 24" className={`absolute h-6 w-6 -rotate-90 ${compacting ? 'animate-pulse motion-reduce:animate-none' : ''}`} aria-hidden="true">
          <circle cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-slate-200 dark:stroke-slate-700" />
          <circle
            cx="12"
            cy="12"
            r={RADIUS}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - Math.max(ratio, 0.02))}
            className={`${tone} transition-[stroke-dashoffset] duration-500`}
          />
        </svg>
        <span className="relative text-[8px] font-semibold tabular-nums leading-none text-slate-600 dark:text-slate-300" aria-hidden="true">
          {percent}
        </span>
      </button>

      {/* Kept in the DOM (hidden) so aria-describedby always points somewhere. */}
      <span id={tipId} className="sr-only">
        {t('chat.contextUsed', { percent, left: 100 - percent })}. {t('chat.contextTokens', { used: tokens(usage.used), window: tokens(usage.window) })}.{' '}
        {busy ? t('chat.contextCompactBusy') : t('chat.contextCompactHint')}
      </span>

      <Popover anchor={button} open={hover || focus} onClose={() => undefined} passive align="end" className="w-60">
        <div
          role="tooltip"
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs leading-relaxed text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
        >
          <p className="mb-1 text-[13px] font-semibold text-slate-900 dark:text-white">{t('chat.contextWindow')}</p>
          <p>{t('chat.contextUsed', { percent, left: 100 - percent })}</p>
          <p className="tabular-nums">{t('chat.contextTokens', { used: tokens(usage.used), window: tokens(usage.window) })}</p>
          <p className="tabular-nums">{t('chat.contextAutoCompact', { at: tokens(Math.round(usage.window * AUTO_COMPACT)), percent: AUTO_COMPACT * 100 })}</p>
          <p className="mt-2 border-t border-slate-100 pt-2 text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {compacting ? t('chat.compacting') : busy ? t('chat.contextCompactBusy') : t('chat.contextCompactHint')}
          </p>
        </div>
      </Popover>
    </>
  );
};

export default ContextRing;
