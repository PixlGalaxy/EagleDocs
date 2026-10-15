/** Keys in `app_settings`. Missing keys fall back to the defaults in code or `.env`. */
export const SETTINGS_KEYS = {
  defaultLanguage: 'app.default_language',
  defaultThemeMode: 'app.default_theme_mode',
  defaultThemeSkin: 'app.default_theme_skin',
  registrationEnabled: 'registration.enabled',
  sessionTtlHours: 'session.ttl_hours',
  eagledocsDailyMessages: 'models.eagledocs_daily_messages',
  mcpEnabled: 'mcp.enabled',
  /** Web push (VAPID). The private key is a secret (secret_enc). */
  pushVapidPublic: 'push.vapid_public',
  pushVapidPrivate: 'push.vapid_private',
  pushContactEmail: 'push.contact_email',
  /** Stripe billing (off by default). The keys are secrets (secret_enc). */
  billingEnabled: 'billing.enabled',
  billingGraceDays: 'billing.grace_days',
  stripeSecretKey: 'stripe.secret_key',
  stripeWebhookSecret: 'stripe.webhook_secret',
  codexEnabled: 'codex.enabled',
  /** ISO date set by the Codex circuit breaker; absent when healthy. */
  codexDisabledUntil: 'codex.disabled_until',

  sandboxImage: 'sandbox.image',
  sandboxCpu: 'sandbox.default_cpu',
  sandboxMemMb: 'sandbox.default_mem_mb',
  sandboxDiskMb: 'sandbox.default_disk_mb',
  sandboxMaxActive: 'sandbox.max_active_per_node',
  sandboxIdleMinutes: 'sandbox.idle_timeout_minutes',
  sandboxNetwork: 'sandbox.network',
  sandboxNetworkList: 'sandbox.network_list',

  smtpHost: 'smtp.host',
  smtpPort: 'smtp.port',
  smtpSecure: 'smtp.secure',
  smtpUser: 'smtp.user',
  /** Secret (secret_enc). */
  smtpPassword: 'smtp.password',
  smtpFromName: 'smtp.from_name',
  smtpFromEmail: 'smtp.from_email',
} as const;
