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
      <Mark kind={kind} size={size} />
    </span>
  );
}

/** The SH mark set up for one animation. */
function Mark({ kind, size }: { kind: BrandLoaderVariant; size: number }) {
  return (
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
  );
}

/** One cycle of every animation (brand-loader.css --bl-dur). */
const CYCLE_MS = 2400;

/** Any animation but `not`, so the same one never plays twice in a row. */
function pickOther(not?: BrandLoaderVariant): BrandLoaderVariant {
  const options = VARIANTS.filter((v) => v !== not);
  return options[Math.floor(Math.random() * options.length)]!;
}

interface Layer {
  id: number;
  kind: BrandLoaderVariant;
  leaving: boolean;
}

/**
 * For longer waits (a picture being made): each animation plays one full
 * cycle, then dissolves into another. The one leaving freezes on its last
 * frame and fades while the next starts, so marks that rest drawn (hop, wave,
 * magnet) and ones that start or end empty (assemble, draw) join without a jump.
 */
export function BrandLoaderCycle({ size = 40, label, className = '' }: Pick<Props, 'size' | 'label' | 'className'>) {
  const [layers, setLayers] = useState<Layer[]>(() => [{ id: 0, kind: pickOther(), leaving: false }]);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const timer = setInterval(() => {
      setLayers((now) => {
        const current = now[now.length - 1]!;
        // Only the one that just finished stays, fading; anything older is gone by now.
        return [{ ...current, leaving: true }, { id: current.id + 1, kind: pickOther(current.kind), leaving: false }];
      });
    }, CYCLE_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <span className={`inline-grid shrink-0 ${className}`} {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}>
      {layers.map((layer) => (
        <span key={layer.id} className={`col-start-1 row-start-1 inline-flex ${layer.leaving ? 'bl-leaving' : 'bl-entering'}`}>
          <Mark kind={layer.kind} size={size} />
        </span>
      ))}
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
