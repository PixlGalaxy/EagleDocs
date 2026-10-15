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
  'agent.delegate': 'tools.agentDelegate',
  'ask.user': 'tools.askUser',
  // The engine's own names (canvas_course -> canvas.course).
  'canvas.course': 'tools.canvasCourse',
  'canvas.assignment': 'tools.canvasAssignmentDetail',
  'canvas.files': 'tools.canvasFiles',
  'canvas.download': 'tools.filesDownload',
  'canvas.save_pages': 'tools.canvasSavePages',
  'canvas.sync_folders': 'tools.canvasSyncFolders',
  'email.inbox': 'tools.emailInbox',
  'time.now': 'tools.timeNow',
  'files.search': 'tools.filesSearch',
  'files.move': 'tools.filesMove',
  'files.mkdir': 'tools.filesMkdir',
  'files.delete': 'tools.filesDelete',
  'files.usage': 'tools.filesUsage',
  'web.search': 'tools.webSearch',
  'web.fetch': 'tools.webFetch',
  'web.download': 'tools.webDownload',
  'rag.search': 'tools.ragSearch',
  'rag.ask': 'tools.ragSearch',
  'rag.add': 'tools.ragAdd',
  'rag.create': 'tools.ragAdd',
  'code.run': 'tools.sandboxExec',
  'browser.open': 'tools.browserOpen',
  'browser.snapshot': 'tools.browserRead',
  'browser.click': 'tools.browserAct',
  'browser.type': 'tools.browserAct',
  'browser.press': 'tools.browserAct',
  'browser.scroll': 'tools.browserAct',
  'browser.back': 'tools.browserAct',
  'browser.close': 'tools.browserAct',
  'browser.screenshot': 'tools.browserScreenshot',
  'memory.update': 'tools.memorySave',
  'skills.note': 'tools.skillsNote',
  'cron.create': 'tools.scheduleCreate',
  'cron.list': 'tools.scheduleManage',
  'cron.update': 'tools.scheduleManage',
  'cron.delete': 'tools.scheduleManage',
  'plan.update': 'tools.planUpdate',
  notify: 'tools.notify',
  calc: 'tools.calc',
  'show.html': 'tools.showHtml',
};

/** The engine names tools `canvas_briefing`; the labels above use `canvas.briefing`. */
export function labelFor(name: string): TranslationKey | undefined {
  return TOOL_LABELS[name] ?? TOOL_LABELS[name.replace('_', '.')];
}

/** A tool's human name in the current language, or its raw name when it has none. */
export function toolLabel(name: string, t: (key: TranslationKey) => string): string {
  const key = labelFor(name);
  return key ? t(key) : name;
}
