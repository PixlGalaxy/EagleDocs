# End-to-end checks

Scripts that drive a running StudyHawk over HTTP, the way the browser does. They need two replicas
(A and B) on the same database to cover the multi-replica paths. Each prints `PASS`/`FAIL` per check.

## Chat and agent (`chat.e2e.mjs`)

Uses the dev seed accounts (`admin/admin`, `user/user`) and a fake OpenAI-compatible model.

```bash
node test/e2e/fake-llm.mjs 4999 &
# Replica A starts the embedded dev Postgres; note the port it logs.
PORT=4001 NODE_ID=node-a npx tsx src/index.ts &
DATABASE_URL=postgres://studyhawk:studyhawk@localhost:<port>/studyhawk MASTER_KEY=$(cat ../data/dev-master.key) \
  PORT=4002 NODE_ID=node-b npx tsx src/index.ts &
node test/e2e/chat.e2e.mjs
```

Against Docker (`docker-compose.dev.yml` with `NODE_ENV=development` on both nodes):
`E2E_A=http://localhost:8080/api E2E_B=http://localhost:8080/api E2E_LLM=http://host.docker.internal:4999/v1 node test/e2e/chat.e2e.mjs`

The fake model reacts to keywords in the last user message: `[time]` and `[memory]` call tools, `[delegate]` and `[delegatebg]`
send two helper agents on the fast and smart models (waiting, or in the background), `[slow]` streams
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

## Sandboxes and replicas (`sandbox-nodes.e2e.mjs`)

Phase 4 acceptance on sandboxes: two users cannot see each other's files, the 512 MB limit kills a process that goes over,
with `max_active_per_node=1` the second user waits and then runs, a sandbox moves to replica B (files and the Outlook
session kept, no new Duo), and a job on a replica that dies becomes `interrupted` in under 60 s and can be retried on B.
The script starts replicas A and B itself (one job worker each) on a shared Postgres and data root, and kills A.
`[py] <code>` makes the fake model run that Python.

```bash
docker run -d --name studyhawk-e2e-pg -e POSTGRES_USER=studyhawk -e POSTGRES_PASSWORD=studyhawk -e POSTGRES_DB=studyhawk \
  -p 55433:5432 postgres:17-alpine
node test/e2e/fake-llm.mjs 4999 & node test/e2e/fake-school.mjs 4997 &
E2E_DATABASE_URL=postgres://studyhawk:studyhawk@localhost:55433/studyhawk E2E_DATA_ROOT=/tmp/e2e-nodes \
  node test/e2e/sandbox-nodes.e2e.mjs
```

## StudyHawk as an MCP app (`mcp.e2e.mjs`)

The script plays an MCP client the way ChatGPT or Claude do: discovery (RFC 9728 and 8414), dynamic registration,
authorize with PKCE, the student's consent (narrowing scopes), the token exchange, MCP calls (tools per scope, memory
shared with the web app, skills as prompts, the profile resource), refresh rotation with reuse detection, the
destructive hint on `files_delete`, revoking from Settings and turning MCP off. Start the backend with `PUBLIC_URL` set
to its own origin so the URLs it advertises are reachable.

```bash
PUBLIC_URL=http://localhost:4000 PORT=4000 npx tsx src/index.ts &
node test/e2e/mcp.e2e.mjs
```

## Plans and billing (`billing.e2e.mjs`)

Runs a fake Stripe API on port 4995 and sends webhooks signed like Stripe. Covers the seeded plans, each plan's limits
(daily messages, schedules, sandbox memory), a plan given by hand and its expiry, turning billing on (keys first),
checkout, signed and duplicate webhooks, the portal, a failed payment's grace period, and cancelling back to Free.

```bash
node test/e2e/fake-llm.mjs 4999 &
STRIPE_API_BASE=http://localhost:4995 PORT=4000 npx tsx src/index.ts &
node test/e2e/billing.e2e.mjs
```

## Web push (`push.e2e.mjs`)

The script runs a fake push service on port 4996 that plays the browser vendor: it decrypts each push (RFC 8291) and checks
the VAPID signature. Covers the Settings test, a finished turn pushed only when no browser follows the chat, the kinds a
device picked, a gone device (410) being removed, broadcasts and their banner, and new VAPID keys dropping subscriptions.
Development accepts local endpoints; production only real push services.

```bash
node test/e2e/fake-llm.mjs 4999 &
PORT=4000 npx tsx src/index.ts &
node test/e2e/push.e2e.mjs
```

## Daily summary (`daily-summary.e2e.mjs`)

The morning push of what is due today and tomorrow, built from Canvas without a model. Covers the setting and its
validation, "send one now" (reaches a device whatever kinds it picked, leaves out overdue and submitted work, opens
Courses), the leader task sending it once the student's hour comes, and not sending it twice the same local day. Uses
`fake-canvas.mjs` and its own fake push service on port 4995; waits for the leader task's ticks, so it takes ~2.5 min.
Run it on a fresh database: a second run the same day finds today's summary already sent.

```bash
node test/e2e/fake-canvas.mjs 4998 &
PORT=4000 npx tsx src/index.ts &
node test/e2e/daily-summary.e2e.mjs
```

## Accounts and admin (`auth-admin.e2e.mjs`)

Production-mode replicas (no dev seed) with `ADMIN_USERNAME=pixl` (or set `E2E_ADMIN`) and password `change-me-now`.
It starts its own fake SMTP server on port 2525; set `E2E_SMTP_HOST=host.docker.internal` when the backend runs in Docker.
Run it on a fresh database: it renames the admin and leaves the IP rate-limited at the end on purpose.
