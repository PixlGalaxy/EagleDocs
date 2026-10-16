# Security

How StudyHawk protects accounts, data and the servers it runs on, what was reviewed, and what is still open.
Last full review: 2026-10-15.

## Reporting a problem

Email security@studyhawk.app with the steps to reproduce. Please do not open a public issue for a vulnerability.

## Accounts and sign-in

- **Passwords:** argon2id. Between 8 and 256 characters; longer ones are refused before hashing (a huge "password"
  would otherwise cost the server on every attempt). The login answers a too-long password like any wrong guess.
- **Login fields:** user name or email up to 254 characters. Both are only ever passed to Postgres as query
  parameters, never built into SQL, and React escapes them on screen, so typed code is just text.
  Logs strip control characters, so a crafted name cannot forge log lines.
- **Rate limits** (shared by every replica, in the `rate_limits` table):

  | Endpoint | Limit |
  | --- | --- |
  | `POST /api/auth/login` | per IP and per account, `LOGIN_RATE_LIMIT_MAX` per `LOGIN_RATE_LIMIT_WINDOW_MINUTES` (10 / 15 min) |
  | `POST /api/auth/change-password` | per user, same as login |
  | `POST /api/auth/register` | 10 per hour per IP |
  | verify, reset password | 30 per 15 min per IP |
  | resend verification, forgot password | per email and per IP |
| `POST /api/contact` (public Contact form) | 5 per hour per IP, 3 per hour per email |

- **Sessions:** random token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` with `COOKIE_SECURE`), stored hashed.
  Users must be `active` on every request; disabling a user or changing a password closes their sessions.
- **CSRF:** `Sec-Fetch-Site` check plus a double-submit token on every state-changing request.
- **Profile updates** accept only `display_name`, `major` and `timezone` (no role, tier or institution), without
  control characters.
- **Admins:** the last active admin cannot be demoted, disabled or deleted.

## Data

- Every query is parameterized; dynamic `UPDATE`s only use fixed column names.
- Every chat, job, approval, schedule, skill, memory file, connection, file and push subscription is read and
  written filtered by the signed-in user.
- **Secrets** (Canvas tokens, API keys, school password, ChatGPT tokens) are encrypted with AES-256-GCM under
  `MASTER_KEY` (full-length tags only) and never returned by the API, written to logs or shown to the model.
- **Input sizes:** JSON bodies 1 MB, message 20k characters, title 120, model reference 200, schedule 100,
  skill 50 KB, uploads 100 MB.
- **Per-user caps:** 50 personal skills, 10 API keys, 10 push devices, schedules per plan.
- One job per chat at a time, enforced under a row lock (two quick sends cannot start two runs).
- **Scheduled tasks** run at least 15 minutes apart, whether written as an interval or as a cron expression; a run
  is skipped while the previous one is still working.
- **Compacting a chat** counts toward the daily limit: once a minute per chat, 20 per hour per user.

## Files and the sandbox

- A user's files live in `/data/workspaces/<id>` and `/data/temp/<id>`. Paths with `..`, absolute paths and the
  browser profile folder are refused.
- The sandbox shares those folders and can create symbolic links in them. The backend never follows one:
  - files are opened with `O_NOFOLLOW`, and the open descriptor's real path is checked against the user's root;
  - uploads go to a random `.part` name created with `O_EXCL`;
  - downloads stream from that checked descriptor;
  - the TEMP sweep and `touchTree` re-check every folder before entering it.
- Downloads are always attachments. Pictures may show inline with
  `Content-Security-Policy: default-src 'none'; sandbox` (SVG never).
- Bytes still uploading are reserved, so parallel uploads cannot overshoot the quota.
- **Sandbox containers:**
  - no capabilities, `no-new-privileges`, read-only root, non-root user;
  - CPU, memory and process limits per plan;
  - no Docker socket inside, and the runner port bound to 127.0.0.1.

## Outbound requests (SSRF)

- **Agent web fetches** reach only public addresses. Each redirect is resolved and checked again, and the
  connection goes to the address that was checked.
- **Students' own model APIs** (OpenAI-compatible base URL) are checked before every request and do not follow
  redirects. Their error bodies are not echoed back.
- **A Canvas address typed by a student** is checked the same way. Canvas file downloads leave the school's
  Canvas only for public `https` addresses.
- `browser_open` refuses internal addresses.
- **Web push** goes only to the browsers' push services (FCM, Mozilla, Apple, Windows) in production.
- **The contact form's Discord webhook** is a secret that only accepts `https://discord.com/api/webhooks/...` (and
  `discordapp.com`, `ptb.`, `canary.`), is checked again before each post, and does not follow redirects. Posts disable
  every mention (`allowed_mentions: { parse: [] }`), and the email escapes the visitor's text.

## Apps (OAuth 2.1 and MCP)

- PKCE S256 only. Exact redirect URI match, https only, or http on localhost; each URI is at most 2,000 characters.
- Single-use codes; refresh tokens rotate; reusing one revokes the whole grant. Tokens are stored as SHA-256.
- Errors before consent show an StudyHawk page instead of redirecting, so `/oauth/authorize` is not an open redirect.
- **Rate limits per IP:**

  | Endpoint | Limit |
  | --- | --- |
  | register | 20 per hour |
  | authorize, token, revoke | 60 per minute |

- **`/mcp`:**
  - at most 10 JSON-RPC messages per request;
  - 240 requests per minute per grant, and 60 tool calls per minute per grant;
  - daily limits per plan;
  - every tool call is recorded in `audit_log` (name only, never arguments).
- Clients that never got a grant are deleted after 7 days.

## Payments (Stripe)

- Webhooks are verified with HMAC over the raw body (5-minute tolerance, constant-time compare). Each event id is
  applied once.
- If applying an event fails, its id is released so Stripe's retry is processed.
- Events older than the last one applied to a subscription are skipped. A late "active" retry cannot undo a
  cancellation.
- A checkout grants the plan only once paid (`payment_status` `paid` or `no_payment_required`).

## Web client and nginx

- No `dangerouslySetInnerHTML`. Markdown runs without raw HTML, and `javascript:` links are dropped.
- Formulas are rendered by KaTeX (no raw HTML, no links). Mermaid diagrams use `securityLevel: 'strict'` with plain-text
  labels and are shown as an `<img>` of the SVG, so a diagram cannot run scripts or load anything.
- Pictures in the agent's answers load only from the user's own files; other images become links. Otherwise a
  prompt injection could leak data in an image address.
- **Headers:** `Content-Security-Policy` (scripts from our origin only), `Strict-Transport-Security`, `nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, and a `Permissions-Policy` that allows only the
  microphone (dictation).
- Access logs record paths without query strings, so one-time tokens never reach the logs.
- Password and login fields stop at the server's limits (`maxLength`).

## Deploying safely

- Set `MASTER_KEY`, `COOKIE_SECURE=true` and `PUBLIC_URL` (https). Set `TRUST_PROXY` only to the proxies in front
  of StudyHawk, or rate limits by IP can be dodged with a forged `X-Forwarded-For`.
- Mount `/data` on the backend with `nosymfollow` (Linux 5.10+). This is the strongest guard against links planted
  by the sandbox.
- Keep Postgres off public interfaces and use a strong password. The dev compose publishes it on 5432 with
  `studyhawk`/`studyhawk`: development only.
- Put `/data` on its own disk or volume, so a full workspace cannot fill the database's disk.

## Open items

These are known and not fixed in code yet, most severe first.

1. **Sandbox network egress.** Code and the browser in the sandbox can reach the internet freely, and through it
   the host's network: LAN services, cloud metadata (169.254.169.254), the Docker host.
   - `browser_open` and the backend's own requests are filtered, but code run in the sandbox is not.
   - Fix: an egress proxy, or `DOCKER-USER` iptables rules on the sandbox bridge that drop RFC 1918, link-local,
     CGNAT and the host gateway.
2. **Runner and user code share a uid.** Code run in the sandbox could read the runner token from
   `/proc/<pid>/environ` and replace the runner. A later school sign-in would then hand the SSO password to it.
   - Fix: run user code as a second uid, keep `.browser` private to the runner, and pass the token through a file
     that is read once and deleted.
3. **The backend image runs as root.** Add `USER` to the Dockerfile and make `/data` owned by that user.
4. **Sandbox disk is checked only before and after a run.** One run can fill the shared disk.
   - Fix: XFS project quotas or a per-user volume, or watch usage during the run and stop it.
5. **Uploads across replicas.** The in-flight reservation is per replica; two replicas can still each accept
   a parallel upload past the quota (bounded by 100 MB per upload).
6. **Open event streams** (chat SSE, admin log tail) are not re-checked after logout or demotion until they
   reconnect.
7. **Secrets are not bound to their row.** Someone with write access to the database could swap two ciphertexts.
   - Fix: AES-GCM additional data with the table, row and user id.
8. **Remaining TOCTOU windows.** `list` and the rename after an upload can still be raced by a link swap in a parent
   folder (directory names only, or within the user's own root). `nosymfollow` closes them.
