/** Keys in `app_settings`. Missing keys fall back to the defaults in code or `.env`. */
export const SETTINGS_KEYS = {
  defaultLanguage: 'app.default_language',
  defaultThemeMode: 'app.default_theme_mode',
  defaultThemeSkin: 'app.default_theme_skin',
  registrationEnabled: 'registration.enabled',
  /** Beta test: nobody signs up on their own; testers sign in with accounts the admin made. */
  betaTest: 'registration.beta_test',
  sessionTtlHours: 'session.ttl_hours',
  studyhawkDailyMessages: 'models.studyhawk_daily_messages',
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
  /** Cores a sandbox keeps while its owner's Compute Units are used up. */
  sandboxThrottleCpu: 'sandbox.throttle_cpu',
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

  /** Public contact form: where messages are emailed (empty means support@studyhawk.app). */
  contactEmailTo: 'contact.email_to',
  /** Secret (secret_enc): a Discord webhook URL. */
  contactDiscordWebhook: 'contact.discord_webhook',

  /** Paid web search after the free ones: 'none', 'brave' or 'tavily'. */
  webSearchPaidProvider: 'web_search.paid_provider',
  /** Secret (secret_enc). */
  webSearchApiKey: 'web_search.api_key',
} as const;
