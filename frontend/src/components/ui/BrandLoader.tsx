import { useEffect, useState } from 'react';
import { BRAND_CYAN, BRAND_H_PATH, BRAND_S_PATH } from '../BrandLogo';
import './brand-loader.css';

export type BrandLoaderVariant = 'assemble' | 'hop' | 'draw' | 'wave' | 'magnet';

const VARIANTS: BrandLoaderVariant[] = ['assemble', 'hop', 'draw', 'wave', 'magnet'];
const S_T = 'scale(1,-1)';
const H_T = 'translate(386,516) scale(1,-1)';

interface Props {
  /** Width in px; the mark is a little taller than wide. */
  size?: number;
  /** Announced to screen readers; omit when visible text next to it already says it is loading. */
  label?: string;
  /** A fixed animation. By default each loader picks one at random. */
  variant?: BrandLoaderVariant;
  /** Waits this long before showing, so quick loads do not flash a loader. */
  delayMs?: number;
  className?: string;
}

/** The animated SH mark, used wherever StudyHawk is loading. */
export default function BrandLoader({ size = 40, label, variant, delayMs = 0, className = '' }: Props) {
  const [kind] = useState(() => variant ?? VARIANTS[Math.floor(Math.random() * VARIANTS.length)]!);
  const [shown, setShown] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!shown) return null;
  return (
    <span className={`inline-flex shrink-0 ${className}`} {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}>
      <svg viewBox="-20 -715 1125 1245" width={size} height={Math.round((size * 1245) / 1125)} className={`brand-loader bl-${kind} text-slate-950 dark:text-white`}>
        {kind === 'draw' && (
          <>
            <path className="bl-line bl-line-s" pathLength={1} transform={S_T} d={BRAND_S_PATH} />
            <path className="bl-line bl-line-h" pathLength={1} transform={H_T} d={BRAND_H_PATH} />
          </>
        )}
        <g className="bl-both">
          <g className="bl-s">
            <path className="bl-outline" transform={S_T} d={BRAND_S_PATH} />
            <path fill="currentColor" transform={S_T} d={BRAND_S_PATH} />
          </g>
          <g className="bl-h">
            <path className="bl-outline" transform={H_T} d={BRAND_H_PATH} />
            <path fill={BRAND_CYAN} transform={H_T} d={BRAND_H_PATH} />
          </g>
        </g>
      </svg>
    </span>
  );
}

/** A centered loader filling its container (a panel, a preview, a lazy page). */
export function BrandLoaderBlock({ size = 48, label, delayMs = 150, className = '' }: Omit<Props, 'variant'>) {
  return (
    <div className={`flex h-full min-h-24 w-full items-center justify-center ${className}`}>
      <BrandLoader size={size} label={label} delayMs={delayMs} />
    </div>
  );
}
