import type { HelperModels, ModelChunk, ModelProvider, ModelRequest, ResolvedModel } from 'pixlai-engine';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import type { SettingsService } from '../../db/settings.js';
import type { Secrets } from '../../crypto/secrets.js';
import { AppError, badRequest } from '../../errors.js';
import { logger } from '../../logger.js';
import { SETTINGS_KEYS as K } from '../admin/settings-keys.js';
import { KEY_PROVIDERS, type ConnectionRow, type ConnectionsService } from '../connections/connections.service.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CODEX_CONTEXT_WINDOW, CodexProvider, FALLBACK_CODEX_MODELS, isAccessBlock } from './providers/codex.js';
import { OpenAIImages, type GeneratedImage, type ImageGenerator, type ImageRequest } from './images.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenAICompatProvider } from './providers/openai-compat.js';
import { assertPublicUrl } from '../../engine/web.js';
import { routeTier, TIER_FALLBACK, TIERS, type ModelTier, type RouteInput } from './router.js';

export type ProviderKind = 'studyhawk' | 'codex' | 'openai_compat' | 'anthropic';

/** What the model picker shows (frontend/src/api/types.ts `ModelOption`). */
export interface ModelOption {
  ref: string;
  provider: ProviderKind;
  label: string;
  source_label: string;
  tags: ModelTier[];
  supports_tools: boolean;
  supports_vision: boolean;
  /** Accepts a thinking level (the composer shows the selector). */
  reasoning: boolean;
}

export interface ModelPrefs {
  mode: 'manual' | 'auto';
  default_model_ref: string | null;
  auto_map: Partial<Record<ModelTier, string>>;
}

interface HawkModelRow {
  id: string;
  model_name: string;
  display_name: string;
  tags: ModelTier[];
  context_window: number;
  supports_tools: boolean;
  supports_vision: boolean;
  endpoint_name: string;
  kind: 'ollama' | 'openai_compat';
  base_url: string;
  api_key_enc: Buffer | null;
}

/** Codex breaker: this many distinct accounts refused within the window turns Codex off for everyone. */
const BREAKER_ACCOUNTS = 3;
const BREAKER_WINDOW_MINUTES = 10;
const BREAKER_PAUSE_HOURS = 6;

/** Tags for models from users' own keys, guessed from their names. */
function guessTags(name: string): ModelTier[] {
  const n = name.toLowerCase();
  const tags = new Set<ModelTier>();
  if (/code|coder|codex|devstral/.test(n)) tags.add('code');
  if (/mini|nano|flash|haiku|small|lite|instant|chat$/.test(n)) tags.add('fast');
  else tags.add('smart');
  if (/gpt-4o|gpt-4\.1|gpt-5|claude|gemini|vision|vl\b|llava|pixtral/.test(n)) tags.add('vision');
  return [...tags];
}

/** `provider:source:model`; model names may contain colons themselves (ollama tags). */
/** Reasoning models by name: local ones (Qwen3, DeepSeek R1, gpt-oss...) and OpenAI's o-series and GPT-5 family. */
export function guessReasoning(name: string): boolean {
  return /qwen3|qwq|qwopus|deepseek-r1|gpt-oss|magistral|reason|think|(^|\/)o[1-9]|gpt-5|gpt-6/i.test(name);
}

export function parseRef(ref: string): { provider: string; source: string; model: string } | null {
  const first = ref.indexOf(':');
  if (first < 0) return null;
  const provider = ref.slice(0, first);
  if (provider === 'studyhawk') return { provider, source: ref.slice(first + 1), model: '' };
  const second = ref.indexOf(':', first + 1);
  if (second < 0) return null;
  return { provider, source: ref.slice(first + 1, second), model: ref.slice(second + 1) };
}

export interface Resolution {
  model: ResolvedModel;
  /** Counts against the daily StudyHawk quota. */
  isStudyHawk: boolean;
  /** Shown before the answer, e.g. when Codex fell back to the StudyHawk model. */
  notice?: string;
}

export class ModelCatalog {
  constructor(
    private db: Db,
    private settings: SettingsService,
    private secrets: Secrets,
    private connections: ConnectionsService,
    private appVersion: string,
  ) {}

  /** Admin switch and breaker together. */
  codexAvailable(): boolean {
    if (!this.settings.getBoolean(K.codexEnabled, true)) return false;
    const until = this.settings.getJson<string | null>(K.codexDisabledUntil, null);
    return !until || new Date(until).getTime() <= Date.now();
  }

  private hawkModels(): Promise<HawkModelRow[]> {
    return many<HawkModelRow>(
      this.db,
      `SELECT m.*, e.name AS endpoint_name, e.kind, e.base_url, e.api_key_enc
       FROM models m JOIN model_endpoints e ON e.id = m.endpoint_id
       WHERE m.enabled AND e.enabled AND NOT (m.tags ? 'embedding') ORDER BY m.display_name`,
    );
  }

  async options(userId: string): Promise<ModelOption[]> {
    const options: ModelOption[] = [];
    for (const m of await this.hawkModels()) {
      options.push({
        ref: `studyhawk:${m.id}`,
        provider: 'studyhawk',
        label: m.display_name,
        source_label: 'StudyHawk',
        tags: m.tags,
        supports_tools: m.supports_tools,
        supports_vision: m.supports_vision,
        reasoning: guessReasoning(m.model_name),
      });
    }
    for (const conn of await this.connections.list(userId)) {
      if (conn.status === 'error') continue;
      const models = Array.isArray(conn.meta.models) ? (conn.meta.models as string[]) : [];
      if (conn.kind === 'codex' && this.codexAvailable()) {
        for (const model of models) {
          options.push({
            ref: `codex:${conn.id}:${model}`,
            provider: 'codex',
            label: model,
            source_label: 'ChatGPT',
            tags: guessTags(model),
            supports_tools: true,
            supports_vision: true,
            reasoning: true,
          });
        }
      } else if (conn.kind === 'api_key') {
        const kind = KEY_PROVIDERS[conn.provider ?? '']?.kind ?? 'openai_compat';
        for (const model of models) {
          options.push({
            ref: `${kind}:${conn.id}:${model}`,
            provider: kind,
            label: model,
            source_label: conn.label,
            tags: guessTags(model),
            supports_tools: true,
            supports_vision: guessTags(model).includes('vision'),
            reasoning: kind !== 'anthropic' && guessReasoning(model),
          });
        }
      }
    }
    return options;
  }

  async prefs(userId: string): Promise<ModelPrefs> {
    const row = await maybe<ModelPrefs>(this.db, 'SELECT mode, default_model_ref, auto_map FROM user_model_prefs WHERE user_id = $1', [userId]);
    return row ?? { mode: 'auto', default_model_ref: null, auto_map: {} };
  }

  async savePrefs(userId: string, body: Record<string, unknown>): Promise<ModelPrefs> {
    const mode = body.mode === 'manual' ? 'manual' : 'auto';
    const refs = new Set((await this.options(userId)).map((o) => o.ref));
    const ref = (value: unknown) => (typeof value === 'string' && refs.has(value) ? value : null);
    const autoMap: Partial<Record<ModelTier, string>> = {};
    const rawMap = (body.auto_map ?? {}) as Record<string, unknown>;
    for (const tier of TIERS) {
      const value = ref(rawMap[tier]);
      if (value) autoMap[tier] = value;
    }
    await this.db.query(
      `INSERT INTO user_model_prefs (user_id, mode, default_model_ref, auto_map) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET mode = excluded.mode, default_model_ref = excluded.default_model_ref, auto_map = excluded.auto_map`,
      [userId, mode, ref(body.default_model_ref), autoMap],
    );
    return this.prefs(userId);
  }

  /** The admin's model for a tier: one tagged with it, else any enabled one. */
  private async hawkDefault(tier: ModelTier): Promise<string | null> {
    const models = await this.hawkModels();
    const tagged = models.find((m) => m.tags.includes(tier)) ?? models.find((m) => TIER_FALLBACK[tier].some((t) => m.tags.includes(t)));
    const chosen = tagged ?? models[0];
    return chosen ? `studyhawk:${chosen.id}` : null;
  }

  /**
   * The models the agent may give its helpers: the user's models that can use
   * tools. A tag ("fast") picks the user's Auto choice for it, else a model
   * with that tag from the same source as the main one, else any.
   */
  async helperModels(userId: string, parentRef: string): Promise<HelperModels> {
    const options = (await this.options(userId)).filter((o) => o.supports_tools);
    const prefs = await this.prefs(userId);
    const parentProvider = parseRef(parentRef)?.provider;
    const pick = (tier: ModelTier): string | undefined => {
      const mapped = prefs.auto_map[tier];
      if (mapped && options.some((o) => o.ref === mapped)) return mapped;
      const tagged = options.filter((o) => o.tags.includes(tier));
      return (tagged.find((o) => o.provider === parentProvider) ?? tagged[0])?.ref;
    };
    return {
      list: options.map((o) => ({ ref: o.ref, label: `${o.source_label} ${o.label}`, tags: o.tags })),
      resolve: async (choice) => {
        const ref = (TIERS as readonly string[]).includes(choice) ? pick(choice as ModelTier) : choice;
        if (!ref || !options.some((o) => o.ref === ref)) return null;
        return (await this.build(userId, ref, null)).model;
      },
    };
  }

  /**
   * Models for small side jobs (a chat's title), best first; the caller tries
   * the next when one fails. A fast model from the same source as the chat
   * comes first (it is the one known to be up), then the chat's own model,
   * then the user's Auto choice for "fast" and the admin's fast model.
   */
  async quickModels(userId: string, chatRef: string | null): Promise<Resolution[]> {
    const options = await this.options(userId);
    const available = new Set(options.map((o) => o.ref));
    const prefs = await this.prefs(userId);
    const chat = chatRef && chatRef !== 'auto' ? chatRef : prefs.mode === 'manual' ? prefs.default_model_ref : null;
    const source = chat ? parseRef(chat) : null;
    const sameSourceFast = source
      ? options.find((o) => {
          const r = parseRef(o.ref);
          // StudyHawk models share one source (the admin's); a connection is its own source.
          return o.tags.includes('fast') && r?.provider === source.provider && (r.provider === 'studyhawk' || r.source === source.source);
        })?.ref
      : undefined;
    const refs = [sameSourceFast, chat, prefs.auto_map.fast, await this.hawkDefault('fast')].filter(
      (ref, i, all): ref is string => Boolean(ref) && available.has(ref!) && all.indexOf(ref) === i,
    );
    const out: Resolution[] = [];
    for (const ref of refs.slice(0, 3)) {
      const built = await this.build(userId, ref, null).catch(() => null);
      if (built) out.push(built);
    }
    return out;
  }

  /** Picks and builds the model for a run. `auto` routes by heuristics. */
  /**
   * Whether a message sent with `requested` would find no model to answer it:
   * Auto (or nothing chosen) with no hosted model, no Auto choice and no default
   * the student can use. Checked before the message is saved, so the app can ask
   * for a default model instead of failing in the background.
   */
  async needsDefault(userId: string, requested: string | null): Promise<boolean> {
    const prefs = await this.prefs(userId);
    const ref = requested || (prefs.mode === 'manual' ? prefs.default_model_ref : null) || 'auto';
    if (ref !== 'auto') return false;
    const available = new Set((await this.options(userId)).map((o) => o.ref));
    if (Object.values(prefs.auto_map).some((r) => r && available.has(r))) return false;
    if ((await this.hawkDefault('smart')) || (await this.hawkDefault('fast'))) return false;
    return !(prefs.default_model_ref && available.has(prefs.default_model_ref));
  }

  async resolve(userId: string, requested: string | null, route: RouteInput): Promise<Resolution> {
    const prefs = await this.prefs(userId);
    let ref = requested || (prefs.mode === 'manual' ? prefs.default_model_ref : null) || 'auto';
    let label: string | null = null;
    let notice: string | undefined;

    if (ref === 'auto') {
      const decision = routeTier(route);
      const available = new Set((await this.options(userId)).map((o) => o.ref));
      const candidates = [decision.tier, ...TIER_FALLBACK[decision.tier]].map((tier) => prefs.auto_map[tier]).filter(Boolean) as string[];
      const picked =
        candidates.find((r) => available.has(r)) ??
        (await this.hawkDefault(decision.tier)) ??
        // Nothing hosted and nothing mapped: the student's own default model (e.g. their ChatGPT).
        (prefs.default_model_ref && available.has(prefs.default_model_ref) ? prefs.default_model_ref : null);
      if (!picked) throw badRequest('models.noModel');
      ref = picked;
      label = 'Auto';
    }

    const parsed = parseRef(ref);
    if (!parsed) throw badRequest('models.unknown');

    if (parsed.provider === 'codex' && !this.codexAvailable()) {
      const fallback = await this.hawkDefault('smart');
      if (!fallback) throw badRequest('models.noModel');
      notice = 'ChatGPT is paused on this server right now, so the StudyHawk model answers instead.';
      return { ...(await this.build(userId, fallback, label)), notice };
    }
    return { ...(await this.build(userId, ref, label)), ...(notice && { notice }) };
  }

  private async build(userId: string, ref: string, autoLabel: string | null): Promise<Resolution> {
    const parsed = parseRef(ref)!;
    const withAuto = (name: string) => (autoLabel ? `${autoLabel} -> ${name}` : name);

    if (parsed.provider === 'studyhawk') {
      const m = (await this.hawkModels()).find((row) => row.id === parsed.source);
      if (!m) throw badRequest('models.unknown');
      const provider =
        m.kind === 'ollama'
          ? new OllamaProvider(m.base_url, m.context_window)
          : new OpenAICompatProvider(m.base_url, m.api_key_enc ? this.secrets.decrypt(m.api_key_enc) : undefined, 'StudyHawk model');
      return {
        isStudyHawk: true,
        model: {
          provider,
          model: m.model_name,
          label: withAuto(m.display_name),
          ref,
          supportsTools: m.supports_tools,
          supportsVision: m.supports_vision,
          contextWindow: m.context_window,
        },
      };
    }

    const conn = await maybe<ConnectionRow>(this.db, 'SELECT * FROM connections WHERE id = $1 AND user_id = $2', [parsed.source, userId]);
    if (!conn) throw badRequest('models.unknown');

    if (parsed.provider === 'codex') {
      const provider = new GuardedCodexProvider(
        new CodexProvider(() => this.connections.codexAccessToken(conn.id), this.appVersion, userId),
        this.db,
        this.settings,
        conn.id,
      );
      return {
        isStudyHawk: false,
        model: { provider, model: parsed.model, label: withAuto(`ChatGPT ${parsed.model}`), ref, supportsTools: true, supportsVision: true, contextWindow: CODEX_CONTEXT_WINDOW },
      };
    }

    const key = this.connections.secretOf(conn);
    const anthropic = parsed.provider === 'anthropic';
    const provider = anthropic ? new AnthropicProvider(key) : new OpenAICompatProvider(String(conn.meta.base_url), key, conn.label, assertPublicUrl);
    return {
      isStudyHawk: false,
      model: {
        provider,
        model: parsed.model,
        label: withAuto(parsed.model),
        ref,
        supportsTools: true,
        supportsVision: anthropic || guessTags(parsed.model).includes('vision'),
        contextWindow: anthropic ? 200_000 : 128_000,
      },
    };
  }

  /**
   * What makes pictures for this student, whatever model the chat runs on:
   * their ChatGPT account first (the chat's own one when it is a ChatGPT
   * model), then an OpenAI API key. null when they have neither.
   */
  async imageGenerator(userId: string, chatRef?: string): Promise<ImageGenerator | null> {
    const conns = (await this.connections.list(userId)).filter((c) => c.status !== 'error');
    const chat = chatRef ? parseRef(chatRef) : null;
    if (this.codexAvailable()) {
      const codex = conns.find((c) => c.kind === 'codex' && chat?.provider === 'codex' && c.id === chat.source) ?? conns.find((c) => c.kind === 'codex');
      if (codex) {
        const listed = Array.isArray(codex.meta.models) ? (codex.meta.models as string[]) : [];
        const model = chat?.provider === 'codex' && chat.source === codex.id ? chat.model : (listed[0] ?? FALLBACK_CODEX_MODELS[0]!);
        const provider = new GuardedCodexProvider(
          new CodexProvider(() => this.connections.codexAccessToken(codex.id), this.appVersion, userId),
          this.db,
          this.settings,
          codex.id,
        );
        return { label: 'ChatGPT', generate: (request) => provider.generateImage(model, request) };
      }
    }
    const openai = conns.find((c) => c.kind === 'api_key' && c.provider === 'openai');
    if (openai) return new OpenAIImages(String(openai.meta.base_url ?? KEY_PROVIDERS.openai!.baseUrl), this.connections.secretOf(openai));
    return null;
  }

  /** The student's daily StudyHawk-model turns (their plan); the admin default when unset. */
  private dailyLimit?: (userId: string) => Promise<number>;

  setDailyLimitSource(source: (userId: string) => Promise<number>): void {
    this.dailyLimit = source;
  }

  /** Daily StudyHawk-model allowance; 0 means unlimited. Throws when used up. */
  async assertQuota(userId: string): Promise<void> {
    const limit = this.dailyLimit ? await this.dailyLimit(userId) : this.settings.getNumber(K.studyhawkDailyMessages, 50);
    if (limit <= 0) return;
    const row = await maybe<{ used: number }>(
      this.db,
      'SELECT studyhawk_messages AS used FROM usage_daily WHERE user_id = $1 AND day = current_date',
      [userId],
    );
    if ((row?.used ?? 0) >= limit) throw new AppError(429, 'models.quotaReached');
  }

  async recordUsage(userId: string, isStudyHawk: boolean, tokensIn: number, tokensOut: number): Promise<void> {
    await this.db.query(
      `INSERT INTO usage_daily (user_id, day, messages, studyhawk_messages, tokens_in, tokens_out)
       VALUES ($1, current_date, 1, $2, $3, $4)
       ON CONFLICT (user_id, day) DO UPDATE SET messages = usage_daily.messages + 1,
         studyhawk_messages = usage_daily.studyhawk_messages + excluded.studyhawk_messages,
         tokens_in = usage_daily.tokens_in + excluded.tokens_in, tokens_out = usage_daily.tokens_out + excluded.tokens_out`,
      [userId, isStudyHawk ? 1 : 0, tokensIn, tokensOut],
    );
  }
}

/**
 * Codex mitigations around one account's provider:
 * - one request at a time per ChatGPT account, across every replica (advisory lock);
 * - refused calls are recorded, and enough distinct accounts refused in a short
 *   window turns Codex off for everyone for a few hours (circuit breaker).
 */
class GuardedCodexProvider implements ModelProvider {
  constructor(
    private inner: CodexProvider,
    private db: Db,
    private settings: SettingsService,
    private connectionId: string,
  ) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelChunk> {
    const client = await this.db.connect();
    const lockKey = `codex:${this.connectionId}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      try {
        yield* this.inner.stream(request);
      } catch (err) {
        if (isAccessBlock(err)) await this.recordRefusal(err as Error & { status: number });
        throw err;
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  /** A picture, under the same one-request-per-account lock and breaker as chat. */
  async generateImage(model: string, request: ImageRequest): Promise<GeneratedImage> {
    const client = await this.db.connect();
    const lockKey = `codex:${this.connectionId}`;
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [lockKey]);
      try {
        return await this.inner.generateImage(model, request);
      } catch (err) {
        if (isAccessBlock(err)) await this.recordRefusal(err as Error & { status: number });
        throw err;
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  }

  private async recordRefusal(err: Error & { status: number }): Promise<void> {
    await this.db.query('INSERT INTO codex_failures (connection_id, status, message) VALUES ($1, $2, $3)', [
      this.connectionId,
      err.status,
      err.message.slice(0, 300),
    ]);
    const row = await maybe<{ accounts: number }>(
      this.db,
      `SELECT COUNT(DISTINCT connection_id) AS accounts FROM codex_failures WHERE created_at > now() - make_interval(mins => $1)`,
      [BREAKER_WINDOW_MINUTES],
    );
    const current = this.settings.getJson<string | null>(K.codexDisabledUntil, null);
    const alreadyPaused = current !== null && new Date(current).getTime() > Date.now();
    if ((row?.accounts ?? 0) >= BREAKER_ACCOUNTS && !alreadyPaused) {
      const until = new Date(Date.now() + BREAKER_PAUSE_HOURS * 3600_000).toISOString();
      await this.settings.set(K.codexDisabledUntil, until);
      logger.error(`Codex circuit breaker tripped: ${row!.accounts} accounts refused in ${BREAKER_WINDOW_MINUTES} min; paused until ${until}`);
    }
  }
}
