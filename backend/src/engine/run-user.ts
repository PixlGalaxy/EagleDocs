import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which student the code running now works for. The engine's ports (embeddings) are shared by
 * every run and do not get the user; the job worker and the MCP server wrap each run in
 * `runAsUser`, so a port can bill and queue the work as that student's (the Accelerator Lab).
 */
const store = new AsyncLocalStorage<{ userId: string }>();

export const runAsUser = <T>(userId: string, fn: () => Promise<T>): Promise<T> => store.run({ userId }, fn);

/** The student this run works for; null outside a run (startup, admin tasks). */
export const currentUser = (): string | null => store.getStore()?.userId ?? null;
