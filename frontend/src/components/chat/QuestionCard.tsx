import { useState } from 'react';
import { Check, MessageCircleQuestion, Send } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { UserQuestion } from '../../api/types';

interface Props {
  questions: UserQuestion[];
  /** A later message exists (or the agent is working): the card only shows what was asked. */
  answered: boolean;
  /** Sends the answers as the student's next message. */
  onAnswer: (text: string) => void;
}

/** The answers as the student's message: one line per question, readable by the agent and in the chat. */
function answerText(questions: UserQuestion[], picked: Set<string>[], other: string[]): string {
  return questions
    .map((q, i) => {
      const parts = [...q.options.filter((o) => picked[i]!.has(o.label)).map((o) => o.label), other[i]!.trim()].filter(Boolean);
      return `${q.header || q.question}: ${parts.join(', ')}`;
    })
    .join('\n');
}

/** The agent's questions with options (ask_user), answered with a click instead of typing. */
const QuestionCard = ({ questions, answered, onAnswer }: Props) => {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Set<string>[]>(() => questions.map(() => new Set()));
  const [other, setOther] = useState<string[]>(() => questions.map(() => ''));

  const toggle = (qi: number, label: string) =>
    setPicked((prev) =>
      prev.map((set, i) => {
        if (i !== qi) return set;
        if (!questions[qi]!.multiSelect) return set.has(label) ? new Set() : new Set([label]);
        const next = new Set(set);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      }),
    );
  const complete = questions.every((_, i) => picked[i]!.size > 0 || other[i]!.trim());

  return (
    <section
      aria-label={t('chat.questionsTitle')}
      className="space-y-4 rounded-xl border border-[var(--accent-200)] bg-[var(--accent-50)]/60 p-4 dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/5"
    >
      <p className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <MessageCircleQuestion size={16} className="text-[var(--accent-600)]" aria-hidden="true" />
        {answered ? t('chat.questionsAnswered') : t('chat.questionsTitle')}
      </p>
      {questions.map((q, qi) => (
        <fieldset key={qi} disabled={answered} className="space-y-2">
          <legend className="mb-2 text-[15px] text-slate-800 dark:text-slate-100">
            {q.header && <span className="mr-2 rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{q.header}</span>}
            {q.question}
            {q.multiSelect && <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{t('chat.questionPickAny')}</span>}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o) => {
              const on = picked[qi]!.has(o.label);
              return (
                <button
                  key={o.label}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(qi, o.label)}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition disabled:cursor-default ${
                    on
                      ? 'border-[var(--accent-500)] bg-white ring-1 ring-[var(--accent-500)] dark:bg-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                  }`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${q.multiSelect ? 'rounded' : 'rounded-full'} ${on ? 'border-[var(--accent-600)] bg-[var(--accent-600)] text-white' : 'border-slate-300 dark:border-slate-600'}`}>
                    {on && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-slate-800 dark:text-slate-100">{o.label}</span>
                    {o.description && <span className="block text-xs text-slate-500 dark:text-slate-400">{o.description}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {!answered && (
            <input
              value={other[qi]}
              onChange={(e) => setOther((prev) => prev.map((v, i) => (i === qi ? e.target.value : v)))}
              placeholder={t('chat.questionOther')}
              aria-label={`${q.header || q.question}: ${t('chat.questionOther')}`}
              maxLength={500}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--accent-500)] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          )}
        </fieldset>
      ))}
      {!answered && (
        <div className="flex justify-end">
          <button
            type="button"
            disabled={!complete}
            onClick={() => onAnswer(answerText(questions, picked, other))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} aria-hidden="true" />
            {t('chat.questionSend')}
          </button>
        </div>
      )}
    </section>
  );
};

export default QuestionCard;
