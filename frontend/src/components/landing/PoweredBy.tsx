import { BRAND_MARKS } from '../brandMarks';

/** Hardware credit, kept apart from the model logos so Intel is not read as a model. */
const PoweredBy = ({ text }: { text: string }) => {
  const intel = BRAND_MARKS.intel!;
  return (
    <div className="flex flex-col items-center gap-3 text-slate-500 sm:flex-row sm:justify-center sm:gap-4 dark:text-slate-400">
      <svg viewBox={intel.viewBox} width={56} height={56} fill="currentColor" role="img" aria-label={intel.title}>
        {intel.paths.map((d) => (
          <path key={d.slice(0, 24)} d={d} />
        ))}
      </svg>
      <p className="text-sm">{text}</p>
    </div>
  );
};

export default PoweredBy;
