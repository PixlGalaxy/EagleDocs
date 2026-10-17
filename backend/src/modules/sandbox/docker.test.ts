import assert from 'node:assert/strict';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DockerClient } from './docker.js';

/** A fake Docker API on a socket (a named pipe on Windows), answering with `handle`. */
async function fakeDocker(handle: (method: string, path: string) => { status: number; body?: unknown }) {
  const socket =
    process.platform === 'win32' ? `\\\\.\\pipe\\studyhawk-test-${process.pid}-${Date.now()}` : join(tmpdir(), `studyhawk-test-${process.pid}-${Date.now()}.sock`);
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').replace(/^\/v[\d.]+/, '');
    calls.push(`${req.method} ${path}`);
    const { status, body } = handle(req.method ?? '', path);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  return { client: new DockerClient([socket]), calls, close: () => server.close() };
}

test('a network another replica created a moment earlier is not an error', async (t) => {
  const docker = await fakeDocker((method) =>
    method === 'GET'
      ? { status: 404, body: { message: 'network studyhawk-sandbox not found' } }
      : { status: 409, body: { message: 'network with name studyhawk-sandbox already exists' } },
  );
  t.after(docker.close);
  await docker.client.ensureNetwork('studyhawk-sandbox');
  assert.deepEqual(docker.calls, ['GET /networks/studyhawk-sandbox', 'POST /networks/create']);
});

test('other failures to create the network still fail', async (t) => {
  const docker = await fakeDocker((method) =>
    method === 'GET' ? { status: 404, body: { message: 'not found' } } : { status: 500, body: { message: 'pool exhausted' } },
  );
  t.after(docker.close);
  await assert.rejects(docker.client.ensureNetwork('studyhawk-sandbox'), /pool exhausted/);
});
