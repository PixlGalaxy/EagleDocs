/** Keys in `app_settings`. Missing keys fall back to the defaults in code or `.env`. */
export const SETTINGS_KEYS = {
  defaultLanguage: 'app.default_language',
  defaultThemeMode: 'app.default_theme_mode',
  defaultThemeSkin: 'app.default_theme_skin',
  registrationEnabled: 'registration.enabled',
  sessionTtlHours: 'session.ttl_hours',
  eagledocsDailyMessages: 'models.eagledocs_daily_messages',
  mcpEnabled: 'mcp.enabled',
  codexEnabled: 'codex.enabled',
  /** ISO date set by the Codex circuit breaker; absent when healthy. */
  codexDisabledUntil: 'codex.disabled_until',

  smtpHost: 'smtp.host',
  smtpPort: 'smtp.port',
  smtpSecure: 'smtp.secure',
  smtpUser: 'smtp.user',
  /** Secret (secret_enc). */
  smtpPassword: 'smtp.password',
  smtpFromName: 'smtp.from_name',
  smtpFromEmail: 'smtp.from_email',
} as const;
