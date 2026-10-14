import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, CircleAlert, ExternalLink, Plug, RefreshCw, Sparkles } from 'lucide-react';
import { canvasApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { CanvasCourse, CanvasItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Page } from '../../components/layout/routes';
import { Badge, EmptyState, Notice, Skeleton } from '../../components/ui/kit';
import { btn, card } from '../../components/ui/styles';
import { dayKey, formatDay, formatTime, priorityTone } from './format';
import type { TranslationKey } from '../../i18n/translations';

/** 412 from /api/canvas/* means the user has not saved a Canvas token yet. */
const NOT_CONNECTED = 412;

const KIND_LABEL: Record<CanvasItem['kind'], TranslationKey> = {
  assignment: 'courses.kindAssignment',
  quiz: 'courses.kindQuiz',
  event: 'courses.kindEvent',
  discussion: 'courses.kindDiscussion',
};

export function UpcomingList({ items }: { items: CanvasItem[] }) {
  const { t, language } = useI18n();
  const groups = useMemo(() => {
    const map = new Map<string, CanvasItem[]>();
    for (const item of items) {
      const key = dayKey(item.due_at);
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.values()];
  }, [items]);

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={dayKey(group[0]!.due_at)}>
          <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {group[0]!.due_at ? formatDay(group[0]!.due_at, language) : t('courses.noDate')}
          </h3>
          <ul className={`${card} divide-y divide-slate-100 dark:divide-slate-800`}>
            {group.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <a
                    href={item.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex max-w-full items-center gap-1.5 font-medium text-slate-900 hover:text-[var(--accent-700)] dark:text-slate-100 dark:hover:text-[var(--accent-300)]"
                  >
                    <span className="truncate">{item.title}</span>
                    <ExternalLink size={13} className="shrink-0 opacity-60" aria-hidden="true" />
                  </a>
                  <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                    {item.course_name} · {t(KIND_LABEL[item.kind])}
                    {item.due_at && ` · ${formatTime(item.due_at, language)}`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {item.submitted ? (
                    <Badge tone="success">{t('courses.submitted')}</Badge>
                  ) : item.missing ? (
                    <Badge tone="danger">{t('courses.missing')}</Badge>
                  ) : null}
                  {item.estimate_hours !== null && <Badge>{t('courses.estimate', { hours: item.estimate_hours })}</Badge>}
                  {item.priority !== null && !item.submitted && (
                    <Badge tone={priorityTone(item.priority)}>{t('courses.priority', { value: Math.round(item.priority) })}</Badge>
                  )}
                  {item.points !== null && <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{t('courses.points', { points: item.points })}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const CoursesPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CanvasCourse[] | null>(null);
  const [items, setItems] = useState<CanvasItem[] | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([canvasApi.courses(), canvasApi.upcoming(14)])
      .then(([c, u]) => {
        if (cancelled) return;
        setCourses(c);
        setItems(u);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === NOT_CONNECTED) setNotConnected(true);
        else setError(err instanceof ApiError ? err.message : t('common.networkError'));
        setCourses([]);
        setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [reload, t]);

  const askPlan = () => navigate('/chat', { state: { prompt: t('chat.suggestDue') } });

  if (notConnected) {
    return (
      <Page title={t('nav.courses')}>
        <EmptyState
          icon={Plug}
          title={t('courses.connectTitle')}
          description={t('courses.connectBody')}
          action={
            <Link to="/settings?section=connections" className={btn.primary}>
              {t('courses.connectAction')}
            </Link>
          }
        />
      </Page>
    );
  }

  return (
    <Page title={t('nav.courses')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('nav.courses')}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={() => {
              setError('');
              setReload((n) => n + 1);
            }} className={btn.secondary}>
            <RefreshCw size={16} aria-hidden="true" />
            {t('common.refresh')}
          </button>
          <button type="button" onClick={askPlan} className={btn.primary}>
            <Sparkles size={16} aria-hidden="true" />
            {t('courses.askPlan')}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="upcoming-heading">
          <h2 id="upcoming-heading" className="mb-4 font-semibold text-slate-900 dark:text-slate-100">
            {t('courses.upcoming')}
          </h2>
          {items === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={BookOpen} title={t('courses.nothingDue')} description={t('courses.nothingDueBody')} />
          ) : (
            <UpcomingList items={items} />
          )}
        </section>

        <section aria-labelledby="courses-heading">
          <h2 id="courses-heading" className="mb-4 font-semibold text-slate-900 dark:text-slate-100">
            {t('courses.active')}
          </h2>
          {courses === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : courses.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('courses.noCourses')}</p>
          ) : (
            <CourseGroups courses={courses} />
          )}
        </section>
      </div>
    </Page>
  );
};



const CourseCard = ({ course }: { course: CanvasCourse }) => (
  <li>
    <Link
      to={`/courses/${course.id}`}
      className={`${card} flex items-center gap-3 p-4 transition hover:border-[var(--accent-300)] dark:hover:border-[var(--accent-500)]/50`}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900 dark:text-slate-100">{course.name}</p>
        <p className="truncate text-sm text-slate-500 dark:text-slate-400">
          {course.course_code}
          {course.term && ` · ${course.term}`}
        </p>
      </div>
      {course.current_score !== null && (
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">{course.current_score.toFixed(1)}%</p>
          {course.current_grade && <p className="text-xs text-slate-500 dark:text-slate-400">{course.current_grade}</p>}
        </div>
      )}
    </Link>
  </li>
);

/** This term's courses first; past terms and organization pages fold under "Other courses". */
const CourseGroups = ({ courses }: { courses: CanvasCourse[] }) => {
  const { t } = useI18n();
  const current = courses.filter((c) => c.current);
  // Some Canvas instances have no term dates: then everything is shown as before.
  const main = current.length > 0 ? current : courses;
  const others = current.length > 0 ? courses.filter((c) => !c.current) : [];
  return (
    <>
      <ul className="space-y-2">
        {main.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}
      </ul>
      {others.length > 0 && (
        <details className="group mt-4">
          <summary className="cursor-pointer select-none text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
            {t('courses.otherCourses', { count: others.length })}
          </summary>
          <ul className="mt-3 space-y-2 opacity-90">
            {others.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
};

export default CoursesPage;
