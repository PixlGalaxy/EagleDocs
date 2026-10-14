import { useRef, useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface Props {
  text: string;
  /** Milliseconds of hover before the description appears. */
  delay?: number;
  children?: ReactNode;
}

/** Hover (or focus, for keyboard users) for a beat and a short description appears above the trigger — an info icon by default. */
const Tooltip = ({ text, delay = 1200, children }: Props) => {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setVisible(false);
  };

  return (
    <span
      className="relative inline-flex items-center"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children ?? <Info size={13} className="cursor-help text-slate-400 dark:text-slate-500" tabIndex={0} />}
      {visible && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {text}
        </div>
      )}
    </span>
  );
};

export default Tooltip;
