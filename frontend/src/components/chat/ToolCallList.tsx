import { useState } from 'react';
import { Check, ChevronRight, CircleAlert, Hourglass, Loader2, Ban } from 'lucide-react';
import type { ToolCall } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';

// Tool names come from the backend registry (plans/03-fase2-chat-modelos.md).
const TOOL_LABELS: Record<string, TranslationKey> = {
  'canvas.courses': 'tools.canvasCourses',
  'canvas.assignments': 'tools.canvasAssignments',
  'canvas.upcoming': 'tools.canvasUpcoming',
  'canvas.announcements': 'tools.canvasAnnouncements',
  'canvas.grades': 'tools.canvasGrades',
  'canvas.modules': 'tools.canvasModules',
  'canvas.assignment_detail': 'tools.canvasAssignmentDetail',
  'canvas.briefing': 'tools.canvasBriefing',
  'email.ensure_session': 'tools.emailSession',
  'email.search': 'tools.emailSearch',
  'email.list_inbox': 'tools.emailInbox',
  'email.read': 'tools.emailRead',
  'email.draft': 'tools.emailDraft',
  'email.send': 'tools.emailSend',
  'degreeworks.audit': 'tools.degreeworksAudit',
  'sandbox.exec': 'tools.sandboxExec',
  'files.list': 'tools.filesList',
  'files.read': 'tools.filesRead',
  'files.write': 'tools.filesWrite',
  'files.download_from_canvas': 'tools.filesDownload',
  'memory.save': 'tools.memorySave',
  'memory.search': 'tools.memorySearch',
  'skills.load': 'tools.skillsLoad',
  'skills.add_note': 'tools.skillsNote',
  'schedule.create': 'tools.scheduleCreate',
};

const STATUS_ICON = {
  running: <Loader2 size={14} className="animate-spin text-[var(--accent-500)] motion-reduce:animate-none" />,
  done: <Check size={14} className="text-emerald-500" />,
  error: <CircleAlert size={14} className="text-rose-500" />,
  waiting_approval: <Hourglass size={14} className="text-amber-500" />,
  rejected: <Ban size={14} className="text-slate-400" />,
} as const;

/** Compact trace of what the agent did, expandable per call. */
const ToolCallList = ({ calls }: { calls: ToolCall[] }) => {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);

  if (!calls.length) return null;

  return (
    <ul className="mb-3 space-y-1">
      {calls.map((call) => {
        const labelKey = TOOL_LABELS[call.name];
        const expanded = open === call.id;
        return (
          <li key={call.id} className="text-sm">
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : call.id)}
              aria-expanded={expanded}
              className="flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-slate-600 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              {STATUS_ICON[call.status]}
              <span className="truncate">{labelKey ? t(labelKey) : call.name}</span>
              <ChevronRight size={14} className={`shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden="true" />
            </button>
            {expanded && (
              <div className="ml-7 mt-1 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                <p className="break-all">
                  <span className="text-slate-400">{call.name}</span> {JSON.stringify(call.args)}
                </p>
                {call.result_preview && <pre className="max-h-48 overflow-auto whitespace-pre-wrap">{call.result_preview}</pre>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default ToolCallList;
