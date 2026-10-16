import { Link } from 'react-router-dom';
import { Languages } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGE_NAMES, SUPPORTED_LANGUAGES, type Language } from '../../i18n/translations';

const PublicFooter = () => {
  const { t, language, setLanguage } = useI18n();

  return (
    <footer className="border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
      <div className="flex w-full flex-col gap-4 px-4 py-6 lg:px-10 text-sm text-slate-600 dark:text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <Link to="/tos" className="hover:text-slate-900 dark:hover:text-white">
            {t('footer.terms')}
          </Link>
          <Link to="/privacy" className="hover:text-slate-900 dark:hover:text-white">
            {t('footer.privacy')}
          </Link>
          <Link to="/contact" className="hover:text-slate-900 dark:hover:text-white">
            {t('footer.contact')}
          </Link>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2">
            <Languages size={16} aria-hidden="true" />
            <span className="sr-only">{t('footer.language')}</span>
            <select
              value={language}
              onChange={(e) => void setLanguage(e.target.value as Language)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {SUPPORTED_LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {LANGUAGE_NAMES[code]}
                </option>
              ))}
            </select>
          </label>
          <p>
            © {new Date().getFullYear()} StudyHawk · {/* Required by the PixlAI-Engine license (pixlai-engine/LICENSE). */}
            {t('footer.builtWith')} -{' '}
            <a href="https://fabriziogamboa.com" target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:text-slate-900 hover:underline dark:hover:text-white">
              fabriziogamboa.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
