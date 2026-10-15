import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageCircleQuestion, Send } from 'lucide-react';
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
function answerText(questions: UserQuestion[], picked: Set<string>[], other: (string | null)[]): string {
  return questions
    .map((q, i) => {
      const parts = [...q.options.filter((o) => picked[i]!.has(o.label)).map((o) => o.label), other[i]?.trim()].filter(Boolean);
      return `${q.header || q.question}: ${parts.join(', ')}`;
    })
    .join('\n');
}

/**
 * The agent's questions with options (ask_user), one at a time: pick an option
 * (a single-choice pick moves on by itself) or write your own answer, then the
 * last step sends them all as the next message.
 */
const QuestionCard = ({ questions, answered, onAnswer }: Props) => {
  const { t } = useI18n();
  const [picked, setPicked] = useState<Set<string>[]>(() => questions.map(() => new Set()));
  /** The student's own answer per question; null while "Other" is not chosen. */
  const [other, setOther] = useState<(string | null)[]>(() => questions.map(() => null));
  const [step, setStep] = useState(0);

  const done = (i: number) => picked[i]!.size > 0 || Boolean(other[i]?.trim());
  const setOtherAt = (value: string | null) => setOther((prev) => prev.map((v, i) => (i === step ? value : v)));
  const last = step === questions.length - 1;
  const q = questions[step]!;

  const choose = (label: string) => {
    if (!q.multiSelect) {
      const wasOn = picked[step]!.has(label);
      setPicked((prev) => prev.map((set, i) => (i === step ? (wasOn ? new Set() : new Set([label])) : set)));
      // One answer only: an option replaces the student's own answer.
      setOtherAt(null);
      // One choice is the whole answer: go on to the next question (the last one waits for "Send").
      if (!wasOn && !last) setTimeout(() => setStep((s) => Math.min(s + 1, questions.length - 1)), 180);
      return;
    }
    setPicked((prev) =>
      prev.map((set, i) => {
        if (i !== step) return set;
        const next = new Set(set);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      }),
    );
  };

  /** "Other": in a one-answer question it replaces the option picked; with several answers it adds to them. */
  const chooseOther = () => {
    if (other[step] !== null) return setOtherAt(null);
    if (!q.multiSelect) setPicked((prev) => prev.map((set, i) => (i === step ? new Set() : set)));
    setOtherAt('');
  };

  const shell = 'rounded-xl border border-[var(--accent-200)] bg-[var(--accent-50)]/60 p-4 dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/5';

  // Answered: what was asked, read-only, all together.
  if (answered) {
    return (
      <section aria-label={t('chat.questionsAnswered')} className={`space-y-2 ${shell}`}>
        <p className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <MessageCircleQuestion size={16} className="text-[var(--accent-600)]" aria-hidden="true" />
          {t('chat.questionsAnswered')}
        </p>
        <ol className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
          {questions.map((item, i) => (
            <li key={i}>
              {item.header && <span className="mr-1.5 font-medium text-slate-700 dark:text-slate-200">{item.header}:</span>}
              {item.question}
            </li>
          ))}
        </ol>
      </section>
    );
  }

  return (
    <section aria-label={t('chat.questionsTitle')} className={`space-y-4 ${shell}`}>
      <div className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
        <MessageCircleQuestion size={16} className="shrink-0 text-[var(--accent-600)]" aria-hidden="true" />
        <span className="flex-1">{t('chat.questionsTitle')}</span>
        {questions.length > 1 && (
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400" aria-live="polite">
            {t('chat.questionStep', { n: step + 1, total: questions.length })}
          </span>
        )}
      </div>

      {/* Where you are: answered questions are filled, the current one is wide. */}
      {questions.length > 1 && (
        <div className="flex gap-1.5" aria-hidden="true">
          {questions.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-[var(--accent-600)]' : done(i) ? 'w-3 bg-[var(--accent-400)]' : 'w-3 bg-slate-300 dark:bg-slate-600'}`}
            />
          ))}
        </div>
      )}

      <fieldset key={step} className="space-y-2">
        <legend className="mb-2 text-[15px] text-slate-800 dark:text-slate-100">
          {q.header && (
            <span className="mr-2 rounded-md bg-white px-1.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{q.header}</span>
          )}
          {q.question}
          <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">{q.multiSelect ? t('chat.questionPickAny') : t('chat.questionPickOne')}</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2" role={q.multiSelect ? 'group' : 'radiogroup'}>
          {[
            ...q.options,
            {
              label: t('chat.questionOtherOption'),
              description: undefined,
              own: true,
            },
          ].map((o) => {
            const own = 'own' in o;
            const on = own ? other[step] !== null : picked[step]!.has(o.label);
            return (
              <button
                key={o.label}
                type="button"
                role={q.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={on}
                onClick={() => (own ? chooseOther() : choose(o.label))}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                  on
                    ? 'border-[var(--accent-500)] bg-white ring-1 ring-[var(--accent-500)] dark:bg-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-slate-600'
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${q.multiSelect ? 'rounded' : 'rounded-full'} ${on ? 'border-[var(--accent-600)] bg-[var(--accent-600)] text-white' : 'border-slate-300 dark:border-slate-600'}`}
                >
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
        {other[step] !== null && (
          <input
            autoFocus
            value={other[step] ?? ''}
            onChange={(e) => setOtherAt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !done(step)) return;
              e.preventDefault();
              if (last) onAnswer(answerText(questions, picked, other));
              else setStep(step + 1);
            }}
            placeholder={t('chat.questionOther')}
            aria-label={`${q.header || q.question}: ${t('chat.questionOther')}`}
            maxLength={500}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[var(--accent-500)] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        )}
      </fieldset>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setStep(step - 1)}
          disabled={step === 0}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-white disabled:invisible dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <ArrowLeft size={14} aria-hidden="true" />
          {t('chat.questionBack')}
        </button>
        {last ? (
          <button
            type="button"
            disabled={!questions.every((_, i) => done(i))}
            onClick={() => onAnswer(answerText(questions, picked, other))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={14} aria-hidden="true" />
            {t('chat.questionSend')}
          </button>
        ) : (
          <button
            type="button"
            disabled={!done(step)}
            onClick={() => setStep(step + 1)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-3 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('chat.questionNext')}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        )}
      </div>
    </section>
  );
};

export default QuestionCard;
