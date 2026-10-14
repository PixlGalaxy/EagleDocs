import pg from 'pg';
import type { EnvConfig } from '../config/env.js';
import type { Db } from '../db/pool.js';
import { logger } from '../logger.js';

/**
 * Channels between replicas. NOTIFY payloads cap at 8 KB, so they only carry
 * ids; whoever receives one reads the details from the database.
 */
export interface BusChannels {
  settings_changed: { key?: string };
  job_events: { jobId: string; seq: number };
  job_control: { jobId: string; action: 'cancel' | 'steer' | 'approval' };
  /** A job was queued: idle workers wake up instead of waiting for their next poll. */
  job_queued: { jobId: string };
  broadcast: { id: string };
  sandbox_control: { userId: string; action: 'stop' };
}
export type BusChannel = keyof BusChannels;
type Handler<C extends BusChannel> = (payload: BusChannels[C]) => void;

const RECONNECT_MS = 2000;

/**
 * LISTEN/NOTIFY over one dedicated connection per replica (a pooled client
 * cannot LISTEN: it would be handed to someone else). Reconnects on its own
 * and re-LISTENs every channel; a missed notification during the gap is fine
 * because every consumer also re-reads state from the DB.
 */
export class Bus {
  private client: pg.Client | null = null;
  private handlers = new Map<BusChannel, Set<Handler<BusChannel>>>();
  private closed = false;
  /** Called after every reconnect, so caches can resync what they may have missed. */
  onReconnect: (() => void) | null = null;

  constructor(private config: EnvConfig, private db: Db) {}

  async start(): Promise<void> {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({
      connectionString: this.config.DATABASE_URL,
      ssl: this.config.DB_SSL ? { rejectUnauthorized: false } : undefined,
      application_name: `eagledocs-bus:${this.config.NODE_ID}`,
    });
    client.on('notification', (message) => this.dispatch(message.channel as BusChannel, message.payload));
    client.on('error', (err) => {
      logger.warn(`Bus connection lost: ${err.message}`);
      this.reconnect(client);
    });
    client.on('end', () => this.reconnect(client));

    await client.connect();
    for (const channel of this.handlers.keys()) await client.query(`LISTEN ${channel}`);
    this.client = client;
  }

  private reconnect(dead: pg.Client) {
    if (this.closed || this.client !== dead) return;
    this.client = null;
    void dead.end().catch(() => undefined);
    const attempt = () => {
      if (this.closed) return;
      this.connect()
        .then(() => {
          logger.info('Bus reconnected');
          this.onReconnect?.();
        })
        .catch((err: Error) => {
          logger.warn(`Bus reconnect failed: ${err.message}`);
          setTimeout(attempt, RECONNECT_MS).unref();
        });
    };
    setTimeout(attempt, RECONNECT_MS).unref();
  }

  private dispatch(channel: BusChannel, raw: string | undefined) {
    const handlers = this.handlers.get(channel);
    if (!handlers) return;
    let payload: unknown;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      logger.warn(`Ignoring malformed ${channel} notification`);
      return;
    }
    for (const handler of handlers) {
      try {
        handler(payload as BusChannels[BusChannel]);
      } catch (err) {
        logger.error(`Bus handler for ${channel} failed`, err);
      }
    }
  }

  /** Subscribes on this replica; returns the unsubscribe function. */
  async on<C extends BusChannel>(channel: C, handler: Handler<C>): Promise<() => void> {
    let set = this.handlers.get(channel);
    if (!set) {
      set = new Set();
      this.handlers.set(channel, set);
      await this.client?.query(`LISTEN ${channel}`);
    }
    set.add(handler as Handler<BusChannel>);
    return () => set.delete(handler as Handler<BusChannel>);
  }

  /** Delivered to every replica, this one included. */
  async publish<C extends BusChannel>(channel: C, payload: BusChannels[C]): Promise<void> {
    await this.db.query('SELECT pg_notify($1, $2)', [channel, JSON.stringify(payload)]);
  }

  async stop(): Promise<void> {
    this.closed = true;
    await this.client?.end().catch(() => undefined);
  }
}
