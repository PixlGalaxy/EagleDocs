import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import express from 'express';
import type { Bus } from '../../bus/bus.js';
import type { AppRequest } from '../../types/index.js';
import { createLiveRoutes } from './live.routes.js';

/** A bus on one process: publish reaches the handlers, as NOTIFY does on every replica. */
function fakeBus() {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const published: string[] = [];
  const bus = {
    on: async (channel: string, handler: (payload: unknown) => void) => {
      if (!handlers.has(channel)) handlers.set(channel, new Set());
      handlers.get(channel)!.add(handler);
      return () => handlers.get(channel)!.delete(handler);
    },
    publish: async (channel: string, payload: unknown) => {
      published.push(channel);
      for (const handler of handlers.get(channel) ?? []) handler(payload);
    },
  };
  return { bus: bus as unknown as Bus, published };
}

async function server(role: 'admin' | 'user' | null) {
  const { bus, published } = fakeBus();
  const live = createLiveRoutes(bus);
  const app = express();
  app.use((req: AppRequest, _res, next) => {
    if (role) {
      req.user = { id: 'u1', role } as AppRequest['user'];
      req.session = {} as AppRequest['session'];
    }
    next();
  });
  app.use('/api/live', live.router);
  app.use('/api/admin', live.announce);
  app.post('/api/admin/settings', (_req, res) => void res.json({ ok: true }));
  app.post('/api/admin/broken', (_req, res) => void res.status(400).json({ error: 'bad' }));
  app.use((err: { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).end();
  });
  const srv = http.createServer(app);
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  return { srv, base, published };
}

test('an admin save reaches an open tab as admin_changed', async (t) => {
  const { srv, base, published } = await server('admin');
  t.after(() => srv.close());

  const received = new Promise<string>((resolve, reject) => {
    http
      .get(`${base}/api/live`, (res) => {
        assert.equal(res.headers['content-type'], 'text/event-stream');
        let body = '';
        res.on('data', (chunk) => {
          body += String(chunk);
          if (body.includes('event: admin_changed')) {
            res.destroy();
            resolve(body);
          }
        });
      })
      .on('error', reject);
  });
  // Let the stream register before the change.
  await new Promise((r) => setTimeout(r, 100));
  await fetch(`${base}/api/admin/settings`, { method: 'POST' });
  assert.match(await received, /event: admin_changed\ndata: \{\}/);
  assert.deepEqual(published, ['admin_changed']);
});

test('failed writes and reads are not announced', async (t) => {
  const { srv, base, published } = await server('admin');
  t.after(() => srv.close());
  await fetch(`${base}/api/admin/broken`, { method: 'POST' });
  await fetch(`${base}/api/admin/settings`);
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(published, []);
});

test('the stream needs a session', async (t) => {
  const { srv, base } = await server(null);
  t.after(() => srv.close());
  const res = await fetch(`${base}/api/live`);
  assert.equal(res.status, 401);
});
