import { BRAND_MARKS, type BrandMark } from '../brandMarks';

const ORDER = ['claude', 'deepseek', 'codex', 'openai'] as const;

// The track scrolls by exactly half its width, then restarts. That only looks
// seamless if each half is wider than the screen, so one half repeats the
// set this many times (4 marks x 4 is roughly 3300px, past 2560px ultrawides).
const SETS_PER_HALF = 4;

function Mark({ mark }: { mark: BrandMark }) {
  return (
    <span
      className="group flex shrink-0 items-center gap-3 text-slate-500 transition-colors duration-300 hover:text-[var(--brand)] dark:text-slate-400"
      style={{ '--brand': mark.color } as React.CSSProperties}
    >
      <svg viewBox={mark.viewBox} width={mark.wordmark ? 64 : 30} height={mark.wordmark ? 64 : 30} fill="currentColor" fillRule="evenodd" aria-hidden={!mark.wordmark} aria-label={mark.wordmark ? mark.title : undefined} role={mark.wordmark ? 'img' : undefined}>
        {mark.paths.map((d) => (
          <path key={d.slice(0, 24)} d={d} />
        ))}
      </svg>
      {!mark.wordmark && (
        <span className="text-xl font-semibold tracking-tight" translate="no">
          {mark.title}
        </span>
      )}
    </span>
  );
}

/**
 * The page's single marquee: model providers EagleDocs can use.
 * Pauses on hover; under reduced motion it becomes a static, wrapping row.
 */
const LogoMarquee = ({ label }: { label: string }) => {
  const marks = ORDER.map((key) => BRAND_MARKS[key]!);
  const half = Array.from({ length: SETS_PER_HALF }, () => marks).flat();
  return (
    <div className="logo-marquee relative overflow-hidden" role="list" aria-label={label}>
      <div className="logo-marquee-track flex w-max items-center gap-16 pr-16">
        {[...half, ...half].map((mark, i) => (
          // Only the first copy of each mark is announced to screen readers.
          <span key={`${mark.title}-${i}`} role="listitem" aria-hidden={i >= marks.length || undefined}>
            <Mark mark={mark} />
          </span>
        ))}
      </div>
    </div>
  );
};

export default LogoMarquee;
