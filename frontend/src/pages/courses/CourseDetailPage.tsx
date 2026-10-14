import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CircleAlert, ExternalLink, Megaphone, Sparkles } from 'lucide-react';
import { canvasApi } from '../../api/account';
import { ApiError } from '../../api/client';
import type { CanvasAnnouncement, CanvasCourse, CanvasItem } from '../../api/types';
import { useI18n } from '../../i18n/I18nContext';
import { Page } from '../../components/layout/routes';
import { EmptyState, Notice, Skeleton } from '../../components/ui/kit';
import { btn, card } from '../../components/ui/styles';
import { UpcomingList } from './CoursesPage';

const CourseDetailPage = () => {
  const { courseId } = useParams();
  const { t, language } = useI18n();
  const navigate = useNavigate();
  const [data, setData] = useState<{ course: CanvasCourse; items: CanvasItem[]; announcements: CanvasAnnouncement[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    canvasApi
      .course(Number(courseId))
      .then(setData)
      .catch((err) => {
        // Not connected: the Courses page shows the "connect Canvas" empty state.
        if (err instanceof ApiError && err.status === 412) navigate('/courses', { replace: true });
        else setError(err instanceof ApiError ? err.message : t('common.networkError'));
      });
  }, [courseId, t, navigate]);

  const title = data?.course.name ?? t('nav.courses');

  return (
    <Page title={title}>
      <Link to="/courses" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
        <ArrowLeft size={16} aria-hidden="true" />
        {t('nav.courses')}
      </Link>

      {error && (
        <div className="mt-4">
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        </div>
      )}

      {!data && !error && (
        <div className="mt-6 space-y-4">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      )}

      {data && (
        <>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">{data.course.name}</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {data.course.course_code}
                {data.course.term && ` · ${data.course.term}`}
                {data.course.current_score !== null && ` · ${data.course.current_score.toFixed(1)}%`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/chat', { state: { prompt: t('courses.planPrompt', { course: data.course.name }) } })}
              className={btn.primary}
            >
              <Sparkles size={16} aria-hidden="true" />
              {t('courses.askPlan')}
            </button>
          </div>

          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <section>
              <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">{t('courses.work')}</h2>
              {data.items.length ? <UpcomingList items={data.items} /> : <EmptyState icon={Sparkles} title={t('courses.nothingDue')} />}
            </section>
            <section>
              <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">{t('courses.announcements')}</h2>
              {data.announcements.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">{t('courses.noAnnouncements')}</p>
              ) : (
                <ul className="space-y-2">
                  {data.announcements.map((a) => (
                    <li key={a.id} className={`${card} p-4`}>
                      <a href={a.html_url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2 font-medium text-slate-900 hover:text-[var(--accent-700)] dark:text-slate-100 dark:hover:text-[var(--accent-300)]">
                        <Megaphone size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
                        <span className="min-w-0">{a.title}</span>
                        <ExternalLink size={13} className="mt-1 shrink-0 opacity-60" aria-hidden="true" />
                      </a>
                      <p className="mt-1 line-clamp-3 text-sm text-slate-600 dark:text-slate-400">{a.preview}</p>
                      <p className="mt-2 text-xs text-slate-500">{new Date(a.posted_at).toLocaleDateString(language, { month: 'short', day: 'numeric' })}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </Page>
  );
};

export default CourseDetailPage;
