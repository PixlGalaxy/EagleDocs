# End-to-end checks

Scripts that drive a running EagleDocs over HTTP, the way the browser does. They need two replicas
(A and B) on the same database to cover the multi-replica paths. Each prints `PASS`/`FAIL` per check.

## Chat and agent (`chat.e2e.mjs`)

Uses the dev seed accounts (`admin/admin`, `user/user`) and a fake OpenAI-compatible model.

```bash
node test/e2e/fake-llm.mjs 4999 &
# Replica A starts the embedded dev Postgres; note the port it logs.
PORT=4001 NODE_ID=node-a npx tsx src/index.ts &
DATABASE_URL=postgres://eagledocs:eagledocs@localhost:<port>/eagledocs MASTER_KEY=$(cat ../data/dev-master.key) \
  PORT=4002 NODE_ID=node-b npx tsx src/index.ts &
node test/e2e/chat.e2e.mjs
```

Against Docker (`docker-compose.dev.yml` with `NODE_ENV=development` on both nodes):
`E2E_A=http://localhost:8080/api E2E_B=http://localhost:8080/api E2E_LLM=http://host.docker.internal:4999/v1 node test/e2e/chat.e2e.mjs`

The fake model reacts to keywords in the last user message: `[time]` and `[memory]` call tools, `[delegate]` and `[delegatebg]`
send two helper agents (waiting, or in the background), `[slow]` streams
slowly (add `[veryslow]` for ~40 s), `[SILENT]` answers `[SILENT]`, a steer gets `corrected: <text>`.

## Canvas (`canvas.e2e.mjs`)

Uses the dev seed accounts, `fake-canvas.mjs` on port 4998 (valid token `canvas-test-token-0123456789`; `POST /__revoke`
invalidates it) and `fake-llm.mjs` on 4999 (`[canvas]` makes the model call `canvas_briefing`). It points the dev
university at the fake Canvas, connects the token, checks the Courses views (pagination over 100 rows, overdue work,
calendar events), the agent's Canvas tool, a revoked token, and that the token never shows in responses or logs.
Run it on a fresh database: it revokes the fake token at the end.

```bash
node test/e2e/fake-canvas.mjs 4998 & node test/e2e/fake-llm.mjs 4999 &
PORT=4000 npx tsx src/index.ts &
node test/e2e/canvas.e2e.mjs
```

## Accounts and admin (`auth-admin.e2e.mjs`)

Production-mode replicas (no dev seed) with `ADMIN_USERNAME=pixl` (or set `E2E_ADMIN`) and password `change-me-now`.
It starts its own fake SMTP server on port 2525; set `E2E_SMTP_HOST=host.docker.internal` when the backend runs in Docker.
Run it on a fresh database: it renames the admin and leaves the IP rate-limited at the end on purpose.
