import type { BadgeTone } from '../../components/ui/kit';

export function priorityTone(priority: number | null): BadgeTone {
  if (priority === null) return 'neutral';
  if (priority >= 70) return 'danger';
  if (priority >= 45) return 'warning';
  return 'neutral';
}

export function dayKey(iso: string | null): string {
  if (!iso) return 'none';
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function formatDay(iso: string, locale: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (same(d, today)) return capitalize(rtf.format(0, 'day'));
  if (same(d, tomorrow)) return capitalize(rtf.format(1, 'day'));
  return capitalize(d.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' }));
}

export function formatTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
