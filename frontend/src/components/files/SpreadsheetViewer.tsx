import { useEffect, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { useI18n } from '../../i18n/I18nContext';
import BrandLoader from '../ui/BrandLoader';

/** Past this many rows or columns, the sheet is cut off: a preview, not a spreadsheet app. */
const LIMITS = { full: { rows: 500, cols: 60 }, compact: { rows: 25, cols: 10 } };

interface Props {
  blob: Blob;
  /** The hover card: the first sheet's top corner only, no tabs. */
  compact?: boolean;
}

/** A workbook as plain tables, with a tab per sheet. */
const SpreadsheetViewer = ({ blob, compact = false }: Props) => {
  const { t } = useI18n();
  const limits = compact ? LIMITS.compact : LIMITS.full;
  const [state, setState] = useState<{ blob: Blob; workbook?: WorkBook; error?: boolean } | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    blob
      .arrayBuffer()
      // One row past the limit is read, so a cut-off sheet can say so.
      .then((buffer) => !cancelled && setState({ blob, workbook: read(buffer, { type: 'array', sheetRows: limits.rows + 1 }) }))
      .catch(() => !cancelled && setState({ blob, error: true }));
    return () => {
      cancelled = true;
    };
  }, [blob, limits.rows]);

  const done = state?.blob === blob ? state : null;
  if (done?.error) return <p className="p-4 text-sm text-rose-600 dark:text-rose-400">{t('chat.previewError')}</p>;
  if (!done?.workbook)
    return (
      <div className="flex h-full items-center justify-center">
        <BrandLoader size={44} delayMs={150} />
      </div>
    );

  const workbook = done.workbook;
  const names = workbook.SheetNames;
  const index = Math.min(sheetIndex, names.length - 1);
  const rows = utils.sheet_to_json<unknown[]>(workbook.Sheets[names[index]], { header: 1, defval: '', blankrows: false, raw: false });
  const shownRows = rows.slice(0, limits.rows);
  const colCount = Math.min(shownRows.reduce((max, row) => Math.max(max, row.length), 0), limits.cols);
  const truncated = rows.length > limits.rows || shownRows.some((row) => row.length > limits.cols);
  const cell = compact ? 'px-2 py-1 text-[11px]' : 'px-3 py-1.5 text-sm';

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-900">
      {truncated && !compact && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">{t('chat.previewTruncated')}</p>
      )}
      {shownRows.length === 0 ? (
        <p className="flex flex-1 items-center justify-center p-4 text-sm text-slate-500 dark:text-slate-400">{t('chat.previewSheetEmpty')}</p>
      ) : (
        <div className={`scroll-thin min-h-0 flex-1 ${compact ? 'overflow-hidden' : 'overflow-auto'}`}>
          <table className="border-collapse">
            <tbody>
              {shownRows.map((row, r) => (
                <tr key={r} className="even:bg-slate-50 dark:even:bg-slate-800/40">
                  {Array.from({ length: colCount }, (_, c) => (
                    <td key={c} className={`max-w-[18rem] truncate whitespace-nowrap border border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200 ${cell}`}>
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {names.length > 1 && !compact && (
        <div className="flex gap-1 overflow-x-auto border-t border-slate-200 px-2 py-1.5 dark:border-slate-700">
          {names.map((sheetName, i) => (
            <button
              key={sheetName}
              type="button"
              onClick={() => setSheetIndex(i)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                i === index
                  ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {sheetName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetViewer;
