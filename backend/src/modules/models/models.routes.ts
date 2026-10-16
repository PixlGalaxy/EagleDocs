import { Router } from 'express';
import type { Secrets } from '../../crypto/secrets.js';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { badRequest, notFound, withDetail } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import type { AppRequest } from '../../types/index.js';
import { requireAdmin, requireAuth } from '../auth/session.middleware.js';
import { toView, type ConnectionsService } from '../connections/connections.service.js';
import { SchoolError, type SchoolService } from '../school/school.service.js';
import type { ModelCatalog } from './catalog.js';
import { discoverOllamaModels } from './providers/ollama.js';
import { listOpenAIModels } from './providers/openai-compat.js';
import { TIERS, type ModelTier } from './router.js';

const UUID = /^[0-9a-f-]{36}$/i;

/** Settings -> Models and Connections, for every signed-in user. */
export function createModelRoutes(db: Db, catalog: ModelCatalog, connections: ConnectionsService, school: SchoolService) {
  const models = Router();
  const conns = Router();
  models.use(requireAuth);
  conns.use(requireAuth);

  models.get('/', async (req: AppRequest, res) => res.json(await catalog.options(req.user!.id)));
  models.get('/prefs', async (req: AppRequest, res) => res.json(await catalog.prefs(req.user!.id)));
  models.put('/prefs', async (req: AppRequest, res) => res.json(await catalog.savePrefs(req.user!.id, (req.body ?? {}) as Record<string, unknown>)));

  conns.get('/', async (req: AppRequest, res) => {
    const user = req.user!;
    const institution = user.institution_id
      ? await maybe<{ name: string; canvas_base_url: string; degreeworks_url: string | null; outlook_url: string | null }>(
          db,
          'SELECT name, canvas_base_url, degreeworks_url, outlook_url FROM institutions WHERE id = $1',
          [user.institution_id],
        )
      : undefined;
    res.json({
      connections: (await connections.list(user.id)).map(toView),
      institution: institution
        ? {
            name: institution.name,
            canvas_base_url: institution.canvas_base_url,
            has_degreeworks: Boolean(institution.degreeworks_url),
            has_outlook: Boolean(institution.outlook_url),
          }
        : null,
    });
  });

  conns.post('/api-keys', async (req: AppRequest, res) => {
    const row = await connections.addApiKey(req.user!.id, (req.body ?? {}) as Record<string, unknown>);
    logger.system.info(`"${req.user!.username}" added a ${row.provider} API key`);
    res.status(201).json(toView(row));
  });

  conns.post('/codex/device', async (req: AppRequest, res) => {
    if (!catalog.codexAvailable()) throw badRequest('models.codexOff');
    res.json(await connections.startCodexLogin(req.user!.id));
  });

  conns.post('/codex/poll', async (req: AppRequest, res) => {
    const result = await connections.pollCodexLogin(req.user!.id, (req.body as { device_auth_id?: unknown })?.device_auth_id);
    res.json({ status: result.status, ...(result.connection && { connection: toView(result.connection) }) });
  });

  conns.post('/:id/test', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    if (!UUID.test(id)) throw notFound();
    const row = await connections.get(req.user!.id, id);
    if (row.kind === 'sso') {
      // A real sign-in, possibly waiting on Duo: it runs in the background and the row shows its progress.
      await school.testSignIn(req.user!.id).catch(async (err: Error) => {
        if (!(err instanceof SchoolError)) throw err;
        await connections.markError(row.id, err.message);
      });
      res.json(toView(await connections.get(req.user!.id, id)));
      return;
    }
    res.json(toView(await connections.test(req.user!.id, id)));
  });

  conns.delete('/:id', async (req: AppRequest, res) => {
    const id = routeParam(req.params.id);
    if (!UUID.test(id)) throw notFound();
    await connections.remove(req.user!.id, id);
    res.status(204).end();
  });

  return { models, conns };
}

interface EndpointRow {
  id: string;
  kind: 'ollama' | 'openai_compat';
  name: string;
  base_url: string;
  enabled: boolean;
  api_key_enc: Buffer | null;
}

/** Admin -> Models: the servers behind the StudyHawk model and which of their models students get. */
export function createAdminModelRoutes(db: Db, secrets: Secrets) {
  const router = Router();
  router.use(requireAdmin);

  const view = async (endpoint: EndpointRow) => ({
    id: endpoint.id,
    kind: endpoint.kind,
    name: endpoint.name,
    base_url: endpoint.base_url,
    enabled: endpoint.enabled,
    api_key_set: Boolean(endpoint.api_key_enc),
    models: await many(
      db,
      `SELECT id, model_name, display_name, tags, context_window, supports_tools, supports_vision, enabled
       FROM models WHERE endpoint_id = $1 ORDER BY model_name`,
      [endpoint.id],
    ),
  });

  const parse = (body: Record<string, unknown>) => {
    const kind = body.kind === 'openai_compat' ? 'openai_compat' : 'ollama';
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 60) : '';
    let baseUrl: string;
    try {
      const url = new URL(String(body.base_url ?? ''));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      baseUrl = url.toString().replace(/\/+$/, '');
    } catch {
      throw badRequest('adminSettings.invalidValue');
    }
    if (!name) throw badRequest('adminSettings.invalidValue');
    return { kind, name, baseUrl, enabled: body.enabled !== false, apiKey: typeof body.api_key === 'string' ? body.api_key : undefined };
  };

  const endpointById = async (id: string) => {
    if (!UUID.test(id)) throw notFound();
    const row = await maybe<EndpointRow>(db, 'SELECT * FROM model_endpoints WHERE id = $1', [id]);
    if (!row) throw notFound();
    return row;
  };

  router.get('/endpoints', async (_req, res) => {
    const rows = await many<EndpointRow>(db, 'SELECT * FROM model_endpoints ORDER BY created_at');
    res.json(await Promise.all(rows.map(view)));
  });

  router.post('/endpoints', async (req, res) => {
    const input = parse((req.body ?? {}) as Record<string, unknown>);
    const { rows } = await db.query<EndpointRow>(
      'INSERT INTO model_endpoints (kind, name, base_url, api_key_enc, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [input.kind, input.name, input.baseUrl, input.apiKey ? secrets.encrypt(input.apiKey) : null, input.enabled],
    );
    res.status(201).json(await view(rows[0]!));
  });

  router.put('/endpoints/:id', async (req, res) => {
    const current = await endpointById(routeParam(req.params.id));
    const input = parse((req.body ?? {}) as Record<string, unknown>);
    // Write-only key: absent keeps it, empty string clears it.
    const keyEnc = input.apiKey === undefined ? current.api_key_enc : input.apiKey ? secrets.encrypt(input.apiKey) : null;
    const { rows } = await db.query<EndpointRow>(
      'UPDATE model_endpoints SET kind = $2, name = $3, base_url = $4, api_key_enc = $5, enabled = $6 WHERE id = $1 RETURNING *',
      [current.id, input.kind, input.name, input.baseUrl, keyEnc, input.enabled],
    );
    res.json(await view(rows[0]!));
  });

  router.delete('/endpoints/:id', async (req, res) => {
    const current = await endpointById(routeParam(req.params.id));
    await db.query('DELETE FROM model_endpoints WHERE id = $1', [current.id]);
    res.status(204).end();
  });

  /** Asks the server which models it has; new ones are added disabled so the admin decides. */
  router.post('/endpoints/:id/discover', async (req, res) => {
    const endpoint = await endpointById(routeParam(req.params.id));
    try {
      if (endpoint.kind === 'ollama') {
        for (const m of await discoverOllamaModels(endpoint.base_url)) {
          const tags: ModelTier[] = [];
          if (/code|coder/i.test(m.name)) tags.push('code');
          if (m.supportsVision) tags.push('vision');
          const allTags: string[] = m.isEmbedding ? ['embedding'] : tags;
          await db.query(
            `INSERT INTO models (endpoint_id, model_name, display_name, tags, context_window, supports_tools, supports_vision)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (endpoint_id, model_name) DO UPDATE SET supports_tools = excluded.supports_tools,
               supports_vision = excluded.supports_vision`,
            [endpoint.id, m.name, m.name, JSON.stringify(allTags), m.contextWindow ?? 32768, m.isEmbedding ? false : m.supportsTools, m.supportsVision],
          );
        }
      } else {
        const key = endpoint.api_key_enc ? secrets.decrypt(endpoint.api_key_enc) : undefined;
        for (const name of await listOpenAIModels(endpoint.base_url, key)) {
          await db.query(
            `INSERT INTO models (endpoint_id, model_name, display_name) VALUES ($1, $2, $2) ON CONFLICT (endpoint_id, model_name) DO NOTHING`,
            [endpoint.id, name],
          );
        }
      }
    } catch (err) {
      throw withDetail(badRequest('models.discoverFailed'), (err as Error).message);
    }
    res.json(await view(endpoint));
  });

  router.patch('/:id', async (req, res) => {
    const id = routeParam(req.params.id);
    if (!UUID.test(id)) throw notFound();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length + 1}`);
    };
    if (typeof body.display_name === 'string' && body.display_name.trim()) set('display_name', body.display_name.trim().slice(0, 80));
    // 'embedding' marks the model used for RAG; the others are chat tiers.
    if (Array.isArray(body.tags)) set('tags', JSON.stringify(body.tags.filter((t) => TIERS.includes(t as ModelTier) || t === 'embedding')));
    if (typeof body.supports_tools === 'boolean') set('supports_tools', body.supports_tools);
    if (typeof body.supports_vision === 'boolean') set('supports_vision', body.supports_vision);
    if (typeof body.enabled === 'boolean') set('enabled', body.enabled);
    if (body.context_window !== undefined) {
      const n = Number(body.context_window);
      if (!Number.isInteger(n) || n < 2048 || n > 2_000_000) throw badRequest('adminSettings.invalidValue');
      set('context_window', n);
    }
    if (sets.length === 0) throw badRequest('adminSettings.invalidValue');
    const row = await maybe(db, `UPDATE models SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...values]);
    if (!row) throw notFound();
    res.json(row);
  });

  return router;
}
