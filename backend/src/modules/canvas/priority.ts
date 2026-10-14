/**
 * Workload estimate and priority score from the canvas-lms skill:
 * priority = 0.45·urgency + 0.25·weight + 0.20·effort + 0.10·status, all 0-100.
 * Pure functions, so they are unit-tested and shared by the Courses page and the agent.
 */

export interface PriorityInput {
  name: string;
  description?: string | null;
  due_at?: string | null;
  points_possible?: number | null;
  submission_types?: string[];
  submitted: boolean;
}

/** Strips HTML to readable text (descriptions and announcements). */
export function stripHtml(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    // Inline tags vanish without a gap ("<b>Thursday</b>." stays "Thursday.").
    .replace(/<\/?(strong|b|em|i|u|span|a|code|sub|sup|small|mark)(\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Hours a typical student needs, from the item's metadata only. */
export function estimateHours(item: PriorityInput): { hours: number; reason: string } {
  const name = item.name.toLowerCase();
  const points = item.points_possible ?? 0;
  const types = (item.submission_types ?? []).join(' ');
  let hours: number;
  let reason: string;
  if (/quiz|exam|midterm/.test(name) || types.includes('online_quiz')) {
    hours = 2;
    reason = 'quiz/exam review';
  } else if (name.includes('project') || points >= 50) {
    hours = 5;
    reason = 'larger or high-point assignment';
  } else if (name.includes('discussion') || types.includes('discussion_topic')) {
    hours = 1;
    reason = 'discussion-style work';
  } else if (name.includes('lab') || name.includes('report')) {
    hours = 3;
    reason = 'lab/report work';
  } else if (types.includes('online_upload') || types.includes('online_text_entry')) {
    hours = 2;
    reason = 'written/upload assignment';
  } else {
    hours = 1.5;
    reason = 'general coursework';
  }
  if (stripHtml(item.description).length > 1500) hours += 1;
  if (points >= 100) hours += 2;
  return { hours, reason };
}

export function priorityScore(item: PriorityInput, now = new Date()): { score: number; label: string } {
  let urgency: number;
  let label: string;
  const due = item.due_at ? new Date(item.due_at) : null;
  if (due && !Number.isNaN(due.getTime())) {
    const hours = (due.getTime() - now.getTime()) / 3_600_000;
    if (hours < 0) [urgency, label] = [100, 'overdue'];
    else if (hours <= 24) [urgency, label] = [95, 'due within 24h'];
    else if (hours <= 72) [urgency, label] = [80, 'due within 3 days'];
    else if (hours <= 168) [urgency, label] = [60, 'due this week'];
    else [urgency, label] = [35, 'later'];
  } else {
    [urgency, label] = [25, 'no due date'];
  }
  const weight = Math.min(item.points_possible ?? 0, 100);
  const effort = Math.min(estimateHours(item).hours * 12, 100);
  const status = item.submitted ? 0 : 35;
  const score = 0.45 * urgency + 0.25 * weight + 0.2 * effort + 0.1 * status;
  return { score: Math.round(score * 10) / 10, label };
}
