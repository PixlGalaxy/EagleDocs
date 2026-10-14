export const LOG_CHANNELS = ['BACKEND', 'FRONTEND', 'AUTH', 'SYSTEM', 'ENTRYPOINT'] as const;
export type LogChannel = (typeof LOG_CHANNELS)[number];
export const LOG_LEVELS = ['INFO', 'WARN', 'ERROR'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  id: number;
  time: string;
  channel: LogChannel;
  level: LogLevel;
  message: string;
}

/** Bounds memory. The cluster-wide history lives in `app_logs`; this is only the local hand-off queue. */
const CAPACITY = 5000;

const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();
let nextId = 1;

export const logBuffer = {
  push(entry: Omit<LogEntry, 'id'>): void {
    const stored = { id: nextId++, ...entry };
    entries.push(stored);
    if (entries.length > CAPACITY) entries.shift();
    for (const listener of listeners) listener(stored);
  },

  /** Entries newer than `id`, oldest first. */
  since(id: number): LogEntry[] {
    return entries.filter((entry) => entry.id > id);
  },

  subscribe(listener: (entry: LogEntry) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
