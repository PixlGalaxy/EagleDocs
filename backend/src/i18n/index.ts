import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Keys the backend sends to clients. Locale files hold more (the frontend's). */
const BACKEND_KEYS = [
  'auth.credentialsRequired',
  'auth.invalidCredentials',
  'auth.notAuthenticated',
  'auth.forbidden',
  'auth.passwordsRequired',
  'auth.passwordTooShort',
  'auth.passwordTooLong',
  'auth.currentPasswordIncorrect',
  'auth.invalidTheme',
  'auth.invalidLanguage',
  'auth.notVerified',
  'auth.accountDisabled',
  'auth.registrationClosed',
  'auth.domainNotAllowed',
  'auth.registrationUnavailable',
  'auth.fieldsRequired',
  'auth.invalidVerification',
  'auth.tooManyAttempts',
  'auth.invalidResetToken',
  'error.internal',
  'error.notFound',
  'error.tooManyRequests',
  'error.crossSiteRequest',
  'error.invalidInput',
  'error.payloadTooLarge',
  'users.invalidEmail',
  'users.invalidUsername',
  'users.emailTaken',
  'users.usernameTaken',
  'users.cannotDeleteSelf',
  'users.lastAdmin',
  'avatars.invalidType',
  'avatars.tooLarge',
  'avatars.noFile',
  'institutions.invalid',
  'institutions.slugTaken',
  'institutions.domainTaken',
  'institutions.invalidDomain',
  'adminSettings.invalidValue',
  'mail.notConfigured',
  'mail.sendFailed',
  'mail.verifySubject',
  'mail.verifyIntro',
  'mail.verifyButton',
  'mail.verifyCode',
  'mail.verifyExpires',
  'mail.resetSubject',
  'mail.resetIntro',
  'mail.resetButton',
  'mail.resetExpires',
  'mail.testSubject',
  'mail.testBody',
  'mail.ignore',
  'chat.emptyMessage',
  'chat.messageTooLong',
  'chat.busy',
  'chat.notRunning',
  'chat.tooManySteers',
  'chat.notRetryable',
  'chat.badAttachments',
  'models.keyRejected',
  'models.codexFailed',
  'models.codexOff',
  'models.noModel',
  'models.unknown',
  'models.quotaReached',
  'models.discoverFailed',
  'schedules.invalid',
  'schedules.limit',
  'admin.alertSmtp',
  'admin.alertNoInstitution',
  'admin.alertNoModel',
  'admin.alertCodexPaused',
  'canvas.notConnected',
  'canvas.tokenRejected',
  'canvas.unavailable',
  'canvas.noBaseUrl',
  'canvas.tokenFormat',
  'files.quota',
  'files.invalidPath',
  'files.notEditable',
  'browser.invalidDomain',
  'browser.canvasReadOnly',
  'push.invalidSubscription',
  'push.invalidEmail',
  'push.titleRequired',
  'push.invalidUrl',
  'pushMsg.testTitle',
  'pushMsg.testBody',
  'pushMsg.mfaTitle',
  'pushMsg.approvalTitle',
  'pushMsg.doneTitle',
  'pushMsg.failedTitle',
  'tiers.nameRequired',
  'tiers.invalidLimit',
  'tiers.invalidPrice',
  'tiers.needsDefault',
  'tiers.priceTaken',
  'billing.off',
  'billing.notForSale',
  'billing.alreadySubscribed',
  'billing.noSubscription',
  'billing.stripeFailed',
  'billing.invalidKey',
  'billing.keysFirst',
] as const;

export type TranslationKey = (typeof BACKEND_KEYS)[number];
/** Looks a key up in `language`, or in the server default when it is not given. */
export type Translate = (key: TranslationKey, language?: string) => string;

export function isLanguage(value: string | undefined | null): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

function loadDictionary(localesDir: string, language: Language): Record<string, string> {
  const path = join(localesDir, `${language}.json`);
  const dictionary = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;

  const missing = BACKEND_KEYS.filter((key) => typeof dictionary[key] !== 'string');
  if (missing.length > 0) {
    throw new Error(`Locale ${path} is missing keys: ${missing.join(', ')}`);
  }
  return dictionary;
}

export function createTranslator(localesDir: string, defaultLanguage: Language): Translate {
  const dictionaries = Object.fromEntries(
    SUPPORTED_LANGUAGES.map((language) => [language, loadDictionary(localesDir, language)]),
  ) as Record<Language, Record<string, string>>;
  logger.info(`Loaded locales (${SUPPORTED_LANGUAGES.join(', ')}) from ${localesDir}`);
  return (key, language) => dictionaries[isLanguage(language) ? language : defaultLanguage][key]!;
}

/** Fills `{name}` placeholders, the same syntax the frontend uses. */
export function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match));
}

/** First supported language in an Accept-Language header, if any. */
export function pickLanguage(acceptLanguage: string | undefined): Language | undefined {
  for (const part of (acceptLanguage ?? '').split(',')) {
    const code = part.trim().slice(0, 2).toLowerCase();
    if (isLanguage(code)) return code;
  }
  return undefined;
}
