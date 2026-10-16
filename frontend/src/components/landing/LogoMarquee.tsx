import { BRAND_MARKS, type BrandMark } from '../brandMarks';

const ORDER = ['claude', 'codex', 'openai', 'gemini', 'deepseek', 'meta', 'kimi', 'ollama'] as const;

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

/** The model providers StudyHawk can use, as a fixed, centered row that wraps on small screens. */
const LogoMarquee = ({ label }: { label: string }) => (
  <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-12 gap-y-6 px-4" role="list" aria-label={label}>
    {ORDER.map((key) => (
      <span key={key} role="listitem">
        <Mark mark={BRAND_MARKS[key]!} />
      </span>
    ))}
  </div>
);

export default LogoMarquee;
