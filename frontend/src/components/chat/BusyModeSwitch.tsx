import { useRef, useState, type PointerEvent } from 'react';
import { CornerDownRight, ListPlus, SkipForward } from 'lucide-react';
import type { BusyInput } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import Tooltip from '../ui/Tooltip';

const MODES = [
  { value: 'steer', label: 'settings.busyInputSteer', hint: 'settings.busyInputSteerHint', icon: CornerDownRight, on: 'text-amber-600 dark:text-amber-400' },
  { value: 'queue', label: 'settings.busyInputQueue', hint: 'settings.busyInputQueueHint', icon: ListPlus, on: 'text-[var(--accent-600)] dark:text-[var(--accent-400)]' },
  { value: 'interrupt', label: 'settings.busyInputInterrupt', hint: 'settings.busyInputInterruptHint', icon: SkipForward, on: 'text-rose-600 dark:text-rose-400' },
] as const;

/** Segment width in px (Tailwind w-7), matched by the sliding highlight. */
const SEGMENT_PX = 28;
/** Press this long and the switch grows and follows the finger or mouse. */
const HOLD_MS = 180;

/**
 * What a message sent while the agent works does (correct it, wait, or stop
 * it), as a small slider in the composer. Hovering a mode says what it does.
 * A tap picks a mode; press and hold and it grows so the highlight can be slid
 * to another one. The choice is the student's setting, so the next chat
 * starts with it too.
 */
const BusyModeSwitch = ({ value, onChange }: { value: BusyInput; onChange: (mode: BusyInput) => void }) => {
  const { t } = useI18n();
  const index = Math.max(0, MODES.findIndex((m) => m.value === value));
  const track = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The press became a slide: the click that follows the release must not pick again. */
  const slid = useRef(false);
  /** While sliding: where the highlight is (px from the left of the track) and which mode is under it. */
  const [drag, setDrag] = useState<{ x: number; index: number } | null>(null);

  const at = (clientX: number) => {
    const rect = track.current!.getBoundingClientRect();
    // The track is scaled while held: work in its unscaled pixels.
    const scale = rect.width / track.current!.offsetWidth || 1;
    const x = Math.min(Math.max((clientX - rect.left) / scale - 2 - SEGMENT_PX / 2, 0), SEGMENT_PX * (MODES.length - 1));
    return { x, index: Math.round(x / SEGMENT_PX) };
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    slid.current = false;
    const clientX = e.clientX;
    const target = e.currentTarget;
    const pointerId = e.pointerId;
    holdTimer.current = setTimeout(() => {
      slid.current = true;
      target.setPointerCapture(pointerId);
      setDrag(at(clientX));
    }, HOLD_MS);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag) setDrag(at(e.clientX));
  };

  const release = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    if (drag) {
      const picked = MODES[drag.index]!.value;
      if (picked !== value) onChange(picked);
      setDrag(null);
    }
  };

  const shownIndex = drag ? drag.index : index;

  return (
    <div
      ref={track}
      role="radiogroup"
      aria-label={t('settings.busyInputTitle')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      className={`relative inline-flex h-8 touch-none select-none items-center rounded-full bg-slate-100 p-0.5 transition-[transform,box-shadow] duration-150 ease-out motion-reduce:transition-none dark:bg-slate-800 ${
        drag ? 'z-20 scale-125 shadow-lg ring-1 ring-slate-200 dark:ring-slate-700' : ''
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 top-0.5 h-7 w-7 rounded-full bg-white shadow-sm dark:bg-slate-600 ${drag ? '' : 'transition-transform duration-200 ease-out motion-reduce:transition-none'}`}
        style={{ transform: `translateX(${drag ? drag.x : index * SEGMENT_PX}px)` }}
      />
      {MODES.map((mode, i) => {
        const Icon = mode.icon;
        const on = i === shownIndex;
        return (
          <Tooltip key={mode.value} text={`${t(mode.label)}: ${t(mode.hint)}`} delay={300} hidden={drag !== null}>
            <button
              type="button"
              role="radio"
              aria-checked={mode.value === value}
              aria-label={`${t(mode.label)}: ${t(mode.hint)}`}
              onClick={() => {
                if (slid.current) return;
                if (mode.value !== value) onChange(mode.value);
              }}
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)]/50 ${
                on ? mode.on : 'text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300'
              }`}
            >
              <Icon size={15} aria-hidden="true" />
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
};

export default BusyModeSwitch;
