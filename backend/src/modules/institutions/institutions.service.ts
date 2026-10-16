import type { Db, Queryable } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { withTx } from '../../db/tx.js';
import { badRequest, conflict, notFound } from '../../errors.js';

export interface InstitutionDomain {
  id: string;
  domain: string;
  include_subdomains: boolean;
}

export interface Institution {
  id: string;
  name: string;
  slug: string;
  canvas_base_url: string;
  degreeworks_url: string | null;
  sso_login_url: string | null;
  outlook_url: string | null;
  enabled: boolean;
  domains: InstitutionDomain[];
  skills: Record<string, boolean>;
  user_count: number;
}

export interface InstitutionInput {
  name: string;
  slug: string;
  canvas_base_url: string;
  degreeworks_url: string | null;
  sso_login_url: string | null;
  outlook_url: string | null;
  enabled: boolean;
  domains: { domain: string; include_subdomains: boolean }[];
  skills: Record<string, boolean>;
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

const canvasOrigin = (url: string | null) => (url ? new URL(url).origin : '');

function optionalUrl(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw badRequest('institutions.invalid');
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('protocol');
    return url.toString().replace(/\/+$/, '');
  } catch {
    throw badRequest('institutions.invalid');
  }
}

/** Validates the admin form body (frontend `Partial<Institution> & { name }`). */
export function parseInstitutionInput(body: Record<string, unknown>): InstitutionInput {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) throw badRequest('institutions.invalid');
  const slug = slugify(typeof body.slug === 'string' && body.slug.trim() ? body.slug : name);
  if (!slug) throw badRequest('institutions.invalid');

  const rawDomains = Array.isArray(body.domains) ? body.domains : [];
  const seen = new Set<string>();
  const domains = rawDomains.map((entry) => {
    const item = entry as { domain?: unknown; include_subdomains?: unknown };
    const domain = typeof item.domain === 'string' ? item.domain.trim().toLowerCase().replace(/^@/, '') : '';
    if (!DOMAIN.test(domain)) throw badRequest('institutions.invalidDomain');
    if (seen.has(domain)) throw conflict('institutions.domainTaken');
    seen.add(domain);
    return { domain, include_subdomains: item.include_subdomains === true };
  });

  const skills: Record<string, boolean> = {};
  if (body.skills && typeof body.skills === 'object') {
    for (const [slugKey, enabled] of Object.entries(body.skills as Record<string, unknown>)) {
      if (/^[a-z0-9-]{1,64}$/.test(slugKey)) skills[slugKey] = enabled === true;
    }
  }

  return {
    name,
    slug,
    // Only the address of the school's Canvas: "https://school.instructure.com/courses" keeps just its origin.
    canvas_base_url: canvasOrigin(optionalUrl(body.canvas_base_url)),
    degreeworks_url: optionalUrl(body.degreeworks_url),
    sso_login_url: optionalUrl(body.sso_login_url),
    outlook_url: optionalUrl(body.outlook_url),
    enabled: body.enabled !== false,
    domains,
    skills,
  };
}

export class InstitutionsService {
  constructor(private db: Db) {}

  async list(): Promise<Institution[]> {
    const rows = await many<Omit<Institution, 'domains' | 'skills'>>(
      this.db,
      `SELECT i.*, (SELECT COUNT(*) FROM users u WHERE u.institution_id = i.id) AS user_count
       FROM institutions i ORDER BY i.name`,
    );
    const domains = await many<InstitutionDomain & { institution_id: string }>(
      this.db,
      'SELECT id, institution_id, domain, include_subdomains FROM institution_domains ORDER BY domain',
    );
    const skills = await many<{ institution_id: string; skill_slug: string; enabled: boolean }>(
      this.db,
      'SELECT institution_id, skill_slug, enabled FROM institution_skills',
    );
    return rows.map((row) => ({
      ...row,
      domains: domains
        .filter((d) => d.institution_id === row.id)
        .map(({ id, domain, include_subdomains }) => ({ id, domain, include_subdomains })),
      skills: Object.fromEntries(skills.filter((s) => s.institution_id === row.id).map((s) => [s.skill_slug, s.enabled])),
    }));
  }

  async get(id: string): Promise<Institution> {
    const found = (await this.list()).find((i) => i.id === id);
    if (!found) throw notFound();
    return found;
  }

  /** What the sign-up page may show while signed out. */
  async listPublic(): Promise<{ name: string; domains: string[] }[]> {
    const rows = await many<{ name: string; domains: string[] | null }>(
      this.db,
      `SELECT i.name, array_agg(d.domain::text ORDER BY d.domain) FILTER (WHERE d.domain IS NOT NULL) AS domains
       FROM institutions i LEFT JOIN institution_domains d ON d.institution_id = i.id
       WHERE i.enabled GROUP BY i.id, i.name ORDER BY i.name`,
    );
    return rows.map((row) => ({ name: row.name, domains: row.domains ?? [] }));
  }

  /**
   * The enabled institution an email belongs to. `alumni.fgcu.edu` matches a
   * `fgcu.edu` entry only when that entry includes subdomains; the most
   * specific domain wins.
   */
  async matchEmail(db: Queryable, email: string): Promise<{ id: string; name: string } | undefined> {
    const host = email.split('@')[1]?.toLowerCase() ?? '';
    const labels = host.split('.');
    const candidates = labels.map((_, i) => labels.slice(i).join('.')).filter((d) => d.includes('.'));
    if (candidates.length === 0) return undefined;
    return maybe<{ id: string; name: string }>(
      db,
      `SELECT i.id, i.name FROM institution_domains d JOIN institutions i ON i.id = d.institution_id
       WHERE i.enabled AND d.domain = ANY($1::citext[]) AND (d.domain = $2::citext OR d.include_subdomains)
       ORDER BY length(d.domain) DESC LIMIT 1`,
      [candidates, host],
    );
  }

  async save(id: string | null, input: InstitutionInput): Promise<Institution> {
    const savedId = await withTx(this.db, async (client) => {
      const slugOwner = await maybe<{ id: string }>(client, 'SELECT id FROM institutions WHERE slug = $1', [input.slug]);
      if (slugOwner && slugOwner.id !== id) throw conflict('institutions.slugTaken');

      let institutionId = id;
      const values = [input.name, input.slug, input.canvas_base_url, input.degreeworks_url, input.sso_login_url, input.outlook_url, input.enabled];
      if (institutionId) {
        const updated = await client.query(
          `UPDATE institutions SET name = $1, slug = $2, canvas_base_url = $3, degreeworks_url = $4, sso_login_url = $5,
             outlook_url = $6, enabled = $7, updated_at = now() WHERE id = $8`,
          [...values, institutionId],
        );
        if (updated.rowCount === 0) throw notFound();
      } else {
        const created = await client.query<{ id: string }>(
          `INSERT INTO institutions (name, slug, canvas_base_url, degreeworks_url, sso_login_url, outlook_url, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          values,
        );
        institutionId = created.rows[0]!.id;
      }

      for (const { domain } of input.domains) {
        const owner = await maybe<{ institution_id: string }>(
          client,
          'SELECT institution_id FROM institution_domains WHERE domain = $1',
          [domain],
        );
        if (owner && owner.institution_id !== institutionId) throw conflict('institutions.domainTaken');
      }
      await client.query('DELETE FROM institution_domains WHERE institution_id = $1', [institutionId]);
      for (const { domain, include_subdomains } of input.domains) {
        await client.query(
          'INSERT INTO institution_domains (institution_id, domain, include_subdomains) VALUES ($1, $2, $3)',
          [institutionId, domain, include_subdomains],
        );
      }

      // Accounts made before this school (or its domain) existed join it now, if their email matches.
      if (input.enabled) {
        await client.query(
          `UPDATE users u SET institution_id = $1, updated_at = now()
           WHERE u.institution_id IS NULL AND EXISTS (
             SELECT 1 FROM institution_domains d WHERE d.institution_id = $1
               AND (split_part(u.email, '@', 2)::citext = d.domain OR (d.include_subdomains AND split_part(u.email, '@', 2)::citext LIKE '%.' || d.domain)))`,
          [institutionId],
        );
      }

      await client.query('DELETE FROM institution_skills WHERE institution_id = $1', [institutionId]);
      for (const [skill, enabled] of Object.entries(input.skills)) {
        await client.query('INSERT INTO institution_skills (institution_id, skill_slug, enabled) VALUES ($1, $2, $3)', [
          institutionId,
          skill,
          enabled,
        ]);
      }
      return institutionId;
    });
    return this.get(savedId);
  }

  /** Users of a deleted institution keep their account; institution_id goes NULL. */
  async delete(id: string): Promise<void> {
    const result = await this.db.query('DELETE FROM institutions WHERE id = $1', [id]);
    if (result.rowCount === 0) throw notFound();
  }
}
