import { api } from './client';

/** The server's limits (backend/src/modules/beta-report/beta-report.service.ts). */
export const BETA_REPORT_LIMITS = { messageMin: 10, message: 3000, screenshotBytes: 8 * 1024 * 1024 } as const;

export const betaReportApi = {
  /** Posts a beta tester's bug report, with an optional screenshot, to the team's Discord channel. */
  send: ({ message, page, screenshot }: { message: string; page: string; screenshot: File | null }) => {
    const form = new FormData();
    form.append('message', message);
    form.append('page', page);
    if (screenshot) form.append('screenshot', screenshot, screenshot.name || 'screenshot.png');
    return api.upload<void>('/beta-report', form);
  },
};
