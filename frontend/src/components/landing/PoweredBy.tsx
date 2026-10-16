import { BRAND_MARKS } from '../brandMarks';

const HARDWARE = ['intel', 'amd'] as const;

/** Hardware credit, kept apart from the model logos so Intel and AMD are not read as models. */
const PoweredBy = ({ text }: { text: string }) => (
  <div className="flex flex-col items-center gap-3 text-slate-500 sm:flex-row sm:justify-center sm:gap-5 dark:text-slate-400">
    <div className="flex items-center gap-4">
      {HARDWARE.map((key, i) => {
        const mark = BRAND_MARKS[key]!;
        return (
          <span key={key} className="flex items-center gap-4">
            {i > 0 && <span className="h-6 w-px bg-slate-300 dark:bg-slate-700" aria-hidden="true" />}
            <svg viewBox={mark.viewBox} width={56} height={56} fill="currentColor" role="img" aria-label={mark.title}>
              {mark.paths.map((d) => (
                <path key={d.slice(0, 24)} d={d} />
              ))}
            </svg>
          </span>
        );
      })}
    </div>
    <p className="text-center text-sm sm:text-left">{text}</p>
  </div>
);

export default PoweredBy;
