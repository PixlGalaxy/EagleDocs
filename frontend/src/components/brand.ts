export const DISCORD_URL = 'https://discord.gg/nFAvRR7aX2';
export const STATUS_URL = 'https://onlinestatus.eagledocs.org';
export const GITHUB_URL = 'https://github.com/PixlGalaxy/StudyHawk';
export const SUPPORT_EMAIL = 'support@studyhawk.app';

/** The app's address; the old EagleDocs domains point here and show a notice first. */
export const NEW_ORIGIN = 'https://studyhawk.app';
export const isOldHost = (host: string) => /(^|\.)eagledocs\.(org|ai)$/i.test(host);
