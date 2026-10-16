import { useEffect, useState } from 'react';
import { CircleAlert, Loader2, Send } from 'lucide-react';
import { pushApi } from '../../api/account';
import type { DailySummary } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { Field, Notice, Panel, Switch } from '../../components/ui/kit';
import { btn, input } from '../../components/ui/styles';

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Settings → Notifications: a morning push with what is due today and tomorrow (built from Canvas, no model). */
const DailySummaryPanel = ({ thisDeviceOn }: { thisDeviceOn: boolean }) => {
  const { t, language } = useI18n();
  const { user } = useAuth();
  const [setting, setSetting] = useState<DailySummary | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<'idle' | 'busy' | string>('idle');

  // Turning this device on or off changes how many devices can receive it.
  useEffect(() => {
    void pushApi.dailySummary().then(setSetting, () => setSetting(null));
  }, [thisDeviceOn]);

  if (!setting) return null;

  const save = async (next: { enabled: boolean; hour: number }) => {
    const previous = setting;
    setSetting({ ...setting, ...next });
    setError('');
    try {
      setSetting(await pushApi.saveDailySummary(next));
    } catch {
      setSetting(previous);
      setError(t('push.dailySaveFailed'));
    }
  };

  const sendNow = async () => {
    setPreview('busy');
    try {
      const r = await pushApi.previewDailySummary();
      setPreview(r.nothing_due ? t('push.dailyPreviewEmpty') : t('push.dailyPreviewSent', { count: r.sent }));
    } catch (err) {
      setPreview(err instanceof Error ? err.message : t('push.failed'));
    }
  };

  const hourLabel = (h: number) => new Intl.DateTimeFormat(language, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, h));

  return (
    <Panel title={t('push.dailyTitle')} description={t('push.dailyBody')}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{t('push.dailySwitch')}</p>
          <Switch label={t('push.dailySwitch')} checked={setting.enabled} onChange={(on) => void save({ enabled: on, hour: setting.hour })} />
        </div>
        {setting.enabled && (
          <div className="flex flex-wrap items-end gap-4">
            <div className="w-40">
              <Field label={t('push.dailyHour')}>
                {(id) => (
                  <select id={id} value={setting.hour} onChange={(e) => void save({ enabled: true, hour: Number(e.target.value) })} className={input}>
                    {HOURS.map((h) => (
                      <option key={h} value={h}>
                        {hourLabel(h)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <button type="button" onClick={() => void sendNow()} disabled={preview === 'busy' || setting.devices === 0 || !setting.canvas_connected} className={btn.secondary}>
              {preview === 'busy' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} aria-hidden="true" />}
              {t('push.dailyPreview')}
            </button>
            {preview !== 'idle' && preview !== 'busy' && <span className="pb-2 text-sm text-slate-500">{preview}</span>}
          </div>
        )}
        {setting.enabled && (
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('push.dailyHourHint', { timezone: user?.timezone || 'America/New_York' })}</p>
        )}
        {setting.enabled && setting.devices === 0 && (
          <Notice tone="warning" icon={CircleAlert}>
            {t('push.dailyNoDevice')}
          </Notice>
        )}
        {setting.enabled && !setting.canvas_connected && (
          <Notice tone="warning" icon={CircleAlert}>
            {t('push.dailyNoCanvas')}
          </Notice>
        )}
        {error && (
          <Notice tone="danger" icon={CircleAlert}>
            {error}
          </Notice>
        )}
      </div>
    </Panel>
  );
};

export default DailySummaryPanel;
