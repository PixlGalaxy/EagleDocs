import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { Db } from '../../db/pool.js';
import { many, maybe } from '../../db/pool.js';
import { logger } from '../../logger.js';

/** A service a skill (and its tools) only makes sense with. Canvas is every institution's. */
export type SkillRequirement = 'canvas' | 'outlook' | 'degreeworks';

export interface BuiltinSkill {
  slug: string;
  name: string;
  /** When to use it: the agent reads this to decide whether to load the skill. */
  description: string;
  requires?: SkillRequirement;
  /** Markdown with {{user.*}} and {{institution.*}} placeholders. */
  body: string;
}

/** backend/skills, next to src/ and dist/ alike. */
export const BUILTIN_SKILLS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../skills');

/** `---` frontmatter with flat `key: value` lines, then the body. */
export function parseSkillFile(slug: string, text: string): BuiltinSkill | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;
  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '');
  }
  if (!meta.name || !meta.description) return null;
  const requires = ['canvas', 'outlook', 'degreeworks'].includes(meta.requires ?? '') ? (meta.requires as SkillRequirement) : undefined;
  return { slug, name: meta.name, description: meta.description, ...(requires && { requires }), body: match[2]!.trim() };
}

export function loadBuiltinSkills(dir = BUILTIN_SKILLS_DIR): BuiltinSkill[] {
  if (!existsSync(dir)) {
    logger.warn(`No built-in skills folder at ${dir}`);
    return [];
  }
  const skills: BuiltinSkill[] = [];
  for (const slug of readdirSync(dir).sort()) {
    const file = join(dir, slug, 'SKILL.md');
    if (!/^[a-z0-9-]{1,48}$/.test(slug) || !existsSync(file)) continue;
    const skill = parseSkillFile(slug, readFileSync(file, 'utf8'));
    if (skill) skills.push(skill);
    else logger.warn(`Skipped built-in skill ${slug}: SKILL.md needs a frontmatter with name and description`);
  }
  return skills;
}

/** Fills {{user.x}} and {{institution.x}}; anything unknown becomes empty rather than leaking braces. */
export function renderSkill(body: string, vars: Record<string, string | null | undefined>): string {
  return body.replace(/\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g, (_m, key: string) => vars[key] ?? '');
}

interface UserContext {
  display_name: string | null;
  username: string;
  major: string | null;
  language: string;
  institution_id: string | null;
  institution_name: string | null;
  canvas_base_url: string | null;
  outlook_url: string | null;
  degreeworks_url: string | null;
}

/** Tools that only make sense where the institution offers the service and has not switched its skill off. */
const GATED_TOOLS: { requires: SkillRequirement; skill: string; tools: RegExp }[] = [
  { requires: 'outlook', skill: 'academic-email', tools: /^email_/ },
  { requires: 'degreeworks', skill: 'degreeworks-map', tools: /^degreeworks_/ },
];

/**
 * Which built-in skills a student gets: the institution must offer the
 * service the skill needs and not have switched it off, and the student must
 * not have turned it off.
 */
export class BuiltinSkills {
  constructor(
    private db: Db,
    readonly all: BuiltinSkill[],
  ) {}

  get(slug: string): BuiltinSkill | undefined {
    return this.all.find((s) => s.slug === slug);
  }

  private context(userId: string) {
    return maybe<UserContext>(
      this.db,
      `SELECT u.display_name, u.username, u.major, u.language, u.institution_id,
              i.name AS institution_name, i.canvas_base_url, i.outlook_url, i.degreeworks_url
         FROM users u LEFT JOIN institutions i ON i.id = u.institution_id WHERE u.id = $1`,
      [userId],
    );
  }

  private offers(ctx: UserContext | null | undefined, requires: SkillRequirement | undefined): boolean {
    if (!requires) return true;
    if (requires === 'canvas') return Boolean(ctx?.canvas_base_url);
    if (requires === 'outlook') return Boolean(ctx?.outlook_url);
    return Boolean(ctx?.degreeworks_url);
  }

  /** Every built-in skill with whether this student has it, and whether they could turn it on. */
  async forUser(userId: string): Promise<(BuiltinSkill & { enabled: boolean; offered: boolean })[]> {
    const ctx = await this.context(userId);
    const [schoolOff, userPrefs] = await Promise.all([
      many<{ skill_slug: string }>(this.db, 'SELECT skill_slug FROM institution_skills WHERE institution_id = $1 AND NOT enabled', [ctx?.institution_id ?? null]),
      many<{ skill_slug: string; enabled: boolean }>(this.db, 'SELECT skill_slug, enabled FROM user_skill_prefs WHERE user_id = $1', [userId]),
    ]);
    const off = new Set(schoolOff.map((r) => r.skill_slug));
    return this.all.map((skill) => {
      const offered = this.offers(ctx, skill.requires) && !off.has(skill.slug);
      const pref = userPrefs.find((p) => p.skill_slug === skill.slug);
      return { ...skill, offered, enabled: offered && (pref?.enabled ?? true) };
    });
  }

  async available(userId: string): Promise<BuiltinSkill[]> {
    return (await this.forUser(userId)).filter((s) => s.enabled);
  }

  /** The skill's instructions for this student, placeholders filled. */
  async render(userId: string, skill: BuiltinSkill): Promise<string> {
    const ctx = await this.context(userId);
    return renderSkill(skill.body, {
      'user.display_name': ctx?.display_name || ctx?.username,
      'user.major': ctx?.major || 'not set',
      'user.language': ctx?.language,
      'institution.name': ctx?.institution_name || 'their university',
      'institution.canvas_base_url': ctx?.canvas_base_url,
      'institution.degreeworks_url': ctx?.degreeworks_url,
    });
  }

  /** Tools to hide from this student's agent (the institution does not offer the service, or switched it off). */
  async hiddenTools(userId: string): Promise<(name: string) => boolean> {
    const ctx = await this.context(userId);
    const off = new Set(
      (await many<{ skill_slug: string }>(this.db, 'SELECT skill_slug FROM institution_skills WHERE institution_id = $1 AND NOT enabled', [ctx?.institution_id ?? null])).map(
        (r) => r.skill_slug,
      ),
    );
    const hidden = GATED_TOOLS.filter((g) => !this.offers(ctx, g.requires) || off.has(g.skill)).map((g) => g.tools);
    return (name) => hidden.some((re) => re.test(name));
  }
}
