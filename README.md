# StudyHawk

An AI agent for university students. It reads Canvas, keeps a private workspace of files, searches the web, runs code
and drives a browser in a per-user sandbox, and can use the student's school account (Outlook, Degree Works). It
explains and guides; it does not hand in graded work as if it were the student's.

- Website: [studyhawk.app](https://studyhawk.app)
- Discord: [StudyHawk Discord](https://discord.gg/nFAvRR7aX2)
- Security: [SECURITY.md](SECURITY.md)

## What is in this repo

| Folder | What it is |
| --- | --- |
| `frontend/` | The web app: React 19, Vite, TypeScript. Installable as a PWA with push notifications. |
| `backend/` | Express API on port 4000, the job worker, and the adapters that connect the engine to Postgres, disk and Docker. |
| `pixlai-engine/` | The agent engine, a separate package with no StudyHawk code in it. See [pixlai-engine/README.md](pixlai-engine/README.md). |
| `sandbox/` | Image of the per-user container: Python with document and data libraries, Chromium, and the runner. |
| `locales/` | Translations shared by the frontend and the backend. |
| `plans/` | Design notes, status log, TODO and an interactive map (`plans/eagledocs-map.html`). |

## How it works

```
browser ──HTTPS──▶ nginx :80 ──/api/──▶ backend :4000 ──INSERT job──▶ PostgreSQL
                                                                         │
                         SSE (job_events) ◀── JobWorker ◀──claim─────────┘
                                                 │
                                           PixlAI-Engine ──▶ model (Ollama, OpenAI-compatible, Anthropic, ChatGPT)
                                                 │
                                    tools: Canvas · files · RAG · web · code · browser · school email
                                                 │
                                   sandbox container per user (via docker.sock)
```

A request only queues the work. A worker on any replica runs the agent and writes every event to the database, and
the browser reads them live over SSE. Closing the tab, reconnecting or running several replicas loses nothing.

Everything the replicas share lives in PostgreSQL (data, job queue, `LISTEN/NOTIFY` bus, leader locks) and in a shared
`/data` folder (workspaces, TEMP, avatars).

## Requirements

- Node.js 20.3 or newer (the images use Node 26).
- Docker, for the sandbox (code, browser and school account) and for the container setup.
- PostgreSQL 14 or newer in production, with `UTF8` encoding. Development starts an embedded one.

## Development

```bash
# 1. Sandbox image (once; without it, code, browser and school tools are off)
docker build -t studyhawk-sandbox:dev sandbox

# 2. Backend: embedded Postgres in data/dev-postgres, generated MASTER_KEY,
#    seed accounts admin/admin and user/user
cd backend && npm install && npm run dev

# 3. Frontend (another terminal)
cd frontend && npm install && npm run dev
```

`npm run dev:mock` in `frontend/` runs the UI with a fake backend, no database needed.

To try two replicas behind a balancer, with Postgres and SearXNG:

```bash
MASTER_KEY=$(openssl rand -base64 32) docker compose -f docker-compose.dev.yml up --build
# http://localhost:8080  (admin / change-me-now)
```

## Production

One container per machine from `ghcr.io/pixlgalaxy/studyhawk`, behind your own TLS proxy. Postgres and the shared
`/data` storage are external.

```bash
cp .env.example .env    # fill in DATABASE_URL, MASTER_KEY, PUBLIC_URL, ADMIN_*
docker run -d --name studyhawk --env-file .env -e NODE_ID=node-1 -p 80:80 \
  -v /mnt/studyhawk/data:/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e SANDBOX_DATA_HOST_PATH=/mnt/studyhawk/data \
  ghcr.io/pixlgalaxy/studyhawk:latest
```

- `MASTER_KEY` must be identical on every replica. Losing it means every stored secret has to be entered again.
- `SANDBOX_DATA_HOST_PATH` is where `/data` lives on the host, so Docker can mount each user's folder into their sandbox.
- Set `COOKIE_SECURE=true`, a `https` `PUBLIC_URL`, and `TRUST_PROXY` to your proxies only.
- SMTP, models, institutions, plans, Stripe and web push are set in the admin panel after the first login.
- Read "Deploying safely" and "Open items" in [SECURITY.md](SECURITY.md) before opening it to students.

Every variable is documented in [.env.example](.env.example). The ones you usually change:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | required | PostgreSQL |
| `MASTER_KEY` | required | 32 bytes, base64: `openssl rand -base64 32` |
| `PUBLIC_URL` | | Public address, used in email links and OAuth |
| `NODE_ID` | hostname | Replica name in the admin panel |
| `JOB_WORKERS` | 4 | Jobs run at the same time per replica |
| `SANDBOX_ENABLED` | true | `false` turns off code, browser and school tools |
| `SANDBOX_IMAGE` | `ghcr.io/pixlgalaxy/studyhawk-sandbox:latest` | Per-user container image |
| `SEARXNG_URL` | | Web search without API keys; empty uses DuckDuckGo |

## Tests

```bash
cd pixlai-engine && npm test      # engine
cd backend && npm test            # backend unit tests
cd frontend && npm run lint && npm run build
```

End-to-end suites drive a running server with fake Canvas, model and school services. See
[backend/test/e2e/README.md](backend/test/e2e/README.md).

## Known risks

- The school account feature stores the student's password (encrypted) and signs in through Microsoft and Duo with
  an automated browser. Schools may not allow this; check the institution's IT policy before enabling it.
- The sandbox can reach the internet without a filter. See "Open items" in [SECURITY.md](SECURITY.md).

## Developers

- [PixlGalaxy](https://github.com/PixlGalaxy)
