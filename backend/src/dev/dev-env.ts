import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'net';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A port the OS says is free right now (fixed ports can fall in Windows' reserved ranges). */
function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

/**
 * Zero-setup development: when NODE_ENV is not production and DATABASE_URL is
 * missing, start a real PostgreSQL from npm (embedded-postgres, a dev
 * dependency that never reaches the image) with its data in data/dev-postgres,
 * and generate a MASTER_KEY kept next to it. With DATABASE_URL set, nothing
 * changes. Same database engine as production, so no SQL differs between modes.
 */
export async function prepareDevEnvironment(): Promise<(() => Promise<void>) | null> {
  if (process.env.NODE_ENV === 'production') return null;
  const devDir = resolve(process.env.DATA_ROOT || join(repoRoot, 'data'));
  mkdirSync(devDir, { recursive: true });

  if (!process.env.MASTER_KEY) {
    const keyFile = join(devDir, 'dev-master.key');
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32).toString('base64'));
    process.env.MASTER_KEY = readFileSync(keyFile, 'utf-8').trim();
    logger.warn(`Using the development MASTER_KEY in ${keyFile}`);
  }

  if (process.env.DATABASE_URL) return null;

  let EmbeddedPostgres: typeof import('embedded-postgres').default;
  try {
    EmbeddedPostgres = (await import('embedded-postgres')).default;
  } catch {
    throw new Error('DATABASE_URL is not set and embedded-postgres is not installed (run npm install in backend/).');
  }
  const dataDir = join(devDir, 'dev-postgres');
  const port = await freePort();
  // Quiet unless it fails; then the last lines explain why.
  const recent: string[] = [];
  const keep = (message: unknown) => {
    recent.push(String(message).trim());
    if (recent.length > 20) recent.shift();
  };
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'eagledocs',
    password: 'eagledocs',
    port,
    persistent: true,
    // Windows would otherwise default to WIN1252, which cannot store emoji or most non-Latin text.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    onLog: keep,
    onError: keep,
  });
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    logger.info(`Creating the development database in ${dataDir} (first run only)`);
    await pg.initialise();
  }
  try {
    await pg.start();
  } catch {
    throw new Error(`The development PostgreSQL did not start:\n${recent.filter(Boolean).join('\n')}`);
  }
  try {
    await pg.createDatabase('eagledocs');
  } catch {
    // Already created on a previous run.
  }
  process.env.DATABASE_URL = `postgres://eagledocs:eagledocs@localhost:${port}/eagledocs`;
  logger.warn(`DATABASE_URL not set: using the embedded development PostgreSQL on port ${port}`);
  return () => pg.stop();
}
