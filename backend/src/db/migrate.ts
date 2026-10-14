import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Db } from './pool.js';
import { LOCKS, withAdvisoryLock } from './tx.js';
import { logger } from '../logger.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Applies `migrations/NNNN_*.sql` in order, each in its own transaction. The
 * advisory lock makes replicas that boot together wait for the first one, so
 * every migration runs exactly once.
 */
export async function runMigrations(db: Db): Promise<void> {
  await withAdvisoryLock(db, LOCKS.migrations, async (client) => {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));

    const files = readdirSync(migrationsDir)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort();

    for (const file of files) {
      const version = parseInt(file.slice(0, 4), 10);
      if (applied.has(version)) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf-8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [version, file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      logger.info(`Applied migration: ${file}`);
    }
  });
}
