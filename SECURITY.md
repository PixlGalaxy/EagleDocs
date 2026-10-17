# Security

How StudyHawk protects accounts, data and the servers it runs on, what was reviewed, and what is still open.
Last full review: 2026-10-16. It covered five areas: sign-in, sessions and cookies; access control on every endpoint;
the sandbox, outbound requests and the agent's tools; encryption and the data lifecycle; and deployment, headers, the web
client and dependencies (`npm audit`: 0 known vulnerabilities in backend, frontend and engine).

## Reporting a problem

Email security@studyhawk.app with the steps to reproduce. Please do not open a public issue for a vulnerability.

## Accounts and sign-in

- **Passwords:** argon2id. Between 8 and 256 characters; longer ones are refused before hashing (a huge "password"
  would otherwise cost the server on every attempt). The login answers a too-long password like any wrong guess, and an
  unknown account takes as long as a wrong password.
- **Login fields:** user name or email up to 254 characters. Both are only ever passed to Postgres as query
  parameters, never built into SQL, and React escapes them on screen, so typed code is just text.
  Logs strip control characters, so a crafted name cannot forge log lines. A failed login logs what was typed only when
  it looks like a user name or email (people type their password there by mistake).
- **Sign-up and email verification:**
  - Confirming an email (by link or by code) also asks for the account's password. The link never confirms on its own,
    so a mail scanner opening it activates nothing, and credentials someone else planted on a student's address can
    never become an active account.
  - Signing up again with an address that is still pending replaces the pending credentials. Activation only happens
    with the password that was just checked.
  - Each try uses up one of the code's 5 attempts before anything is compared, so parallel guesses cannot go past the
    limit. A new code goes out at most once a minute and 5 times a day per address, through sign-up or "resend".
  - Forgot password answers the same way, and just as fast, whether or not the account exists.
- **Rate limits** (shared by every replica, in the `rate_limits` table). IPv6 clients count per /64, since one client
  usually holds a whole /64:

  | Endpoint | Limit |
  | --- | --- |
  | `POST /api/auth/login` | per IP and per account, `LOGIN_RATE_LIMIT_MAX` per `LOGIN_RATE_LIMIT_WINDOW_MINUTES` (10 / 15 min) |
  | `POST /api/auth/change-password`, `POST /api/auth/delete-account` | per user, same as login |
  | `POST /api/auth/register` | 10 per hour per IP |
  | verify, reset password | 30 per 15 min per IP; 5 attempts per code |
  | resend verification, forgot password | per email and per IP |
  | `POST /api/contact` (public Contact form) | 5 per hour per IP, 3 per hour per email |
  | `POST /api/beta-report` | 5 per hour and 15 per day per user, only during a beta test |
  | data export | 3 per hour per user |

- **Sessions:**
  - A random 256-bit token, stored hashed, in an `httpOnly`, `SameSite=Lax` cookie.
  - The cookie is `Secure` whenever `PUBLIC_URL` is https (or `COOKIE_SECURE=true`). It is then named `__Host-session`
    (and the CSRF cookie `__Host-csrf`), so no sibling subdomain can set or shadow it.
  - Users must be `active` on every request, and role and status are read fresh each time.
  - A changed or reset password, an admin password reset or a disabled account ends every session and revokes every
    app connected over MCP (grants and their tokens). A refresh token never works for an account that is not active.
  - Signing out also sends `Clear-Site-Data: "cache"`. API answers are `Cache-Control: no-store` unless a route says
    otherwise, so nothing private stays in a shared computer's cache.
- **CSRF:** `Sec-Fetch-Site` check plus a double-submit token on every state-changing request (login, uploads and the
  OAuth consent included). There is no CORS on the cookie API.
- **Profile updates** accept only `display_name`, `major` and `timezone` (no role, tier or institution), without
  control characters.
- **Admins:**
  - The last active admin cannot be demoted, disabled or deleted.
  - The first admin comes from `ADMIN_*` only when there is no admin at all. It never promotes an account that already
    exists, and in production (outside localhost) a placeholder or short `ADMIN_PASSWORD` stops the boot.
- **Dev accounts** (`admin/admin`, `user/user`) exist only outside production, and only on the embedded development
  database (or with `DEV_SEED=true`). A wrong `NODE_ENV` against a real database never creates them.

## Data

- Every query is parameterized; dynamic `UPDATE`s only use fixed column names.
- Every chat, job, approval, schedule, skill, memory file, connection, file and push subscription is read and
  written filtered by the signed-in user. Every `/api/admin` route requires an admin.
- **Secrets** (Canvas tokens, API keys, the school password, ChatGPT tokens, SMTP/Stripe/Discord/VAPID secrets) are
  encrypted with AES-256-GCM under `MASTER_KEY`. Each encryption uses a random IV, and only full-length tags are accepted.
  `MASTER_KEY` must be 32 bytes and is checked against the database at boot.
  - Secrets are never returned by the API (only "is set" flags or a last-4 hint), never written to logs and never shown
    to the model.
- **Hashed, never stored:** session tokens, reset and verification tokens, codes, OAuth codes, tokens and client secrets.
- **Database connection:** `DB_SSL=true` (or `verify`) checks the server certificate, against `DB_SSL_CA` if set.
  `no-verify` only encrypts, for setups that cannot do better.
- **Logs:** request lines record the path only, never the query string (file names, searches, one-time tokens). Logs
  are admin only and kept 7 days in the database.
- **Input sizes:** JSON bodies 1 MB, message 20k characters, title 120, model reference 200, schedule 100,
  skill 50 KB, uploads 100 MB.
- **Per-user caps:** 50 personal skills, 10 API keys, 10 push devices, schedules per plan.
- One job per chat at a time, enforced under a row lock (two quick sends cannot start two runs).
- **Scheduled tasks** run at least 15 minutes apart, whether written as an interval or as a cron expression; a run
  is skipped while the previous one is still working.
- **Compacting a chat** counts toward the daily limit: once a minute per chat, 20 per hour per user.
- **Deleting an account:**
  - 30 days to change one's mind. Sessions, apps and push devices are cut at once, and Stripe is cancelled at once.
  - Then the purge erases the row (every table cascades), the workspace, TEMP, the browser profiles and the avatar.
  - Admins delete an account at once.
- **Data export** contains only the user's own rows and files: no hashes, tokens, encrypted columns or browser profiles.

## Files and the sandbox

- A user's files live in `/data/workspaces/<id>` and `/data/temp/<id>`. Paths with `..`, absolute paths and the
  browser profile folder are refused.
- The sandbox shares those folders and can create symbolic links in them. The backend never follows one:
  - files are opened with `O_NOFOLLOW`, and the open descriptor's real path is checked against the user's root;
  - delete, move and copy work on the real path of the parent folder, refused if it is outside the user's root, and a
    link itself is removed, never followed;
  - uploads go to a random `.part` name created with `O_EXCL`;
  - downloads stream from that checked descriptor;
  - the TEMP sweep and `touchTree` re-check every folder before entering it.
- **Browser profiles** (Settings → Browser):
  - Listing ignores a `.browser` or profile that is a link.
  - Clearing a profile first stops the user's sandbox on whichever replica runs it, then removes only real folders
    inside the user's own root (a link is unlinked, never followed).
  - Removing the school account also clears its Outlook and Degree Works profiles.
- **The saved school password** is only typed into https pages on Microsoft's sign-in, the school's own domains, the
  service being opened or the institution's SSO URL. Any other page with a password box gets nothing.
- Downloads are always attachments. Pictures may show inline with
  `Content-Security-Policy: default-src 'none'; sandbox` (SVG never).
- **Pages the agent shows** (`show_html`):
  - sandboxed (opaque origin, no network, no forms);
  - served only inside the chat's frame;
  - "Open" makes that frame fill the screen instead of a new tab, where a script could navigate away carrying what the
    page shows.
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
- **Discord webhooks** (the contact form and beta bug reports):
  - secrets that only accept `https://discord.com/api/webhooks/...` (and `discordapp.com`, `ptb.`, `canary.`);
  - checked again before each post, and redirects are not followed;
  - posts disable every mention (`allowed_mentions: { parse: [] }`);
  - screenshots are checked by their bytes (PNG, JPEG, WebP, GIF, up to 8 MB).

## Apps (OAuth 2.1 and MCP)

- PKCE S256 only. Exact redirect URI match, https only, or http on localhost; each URI is at most 2,000 characters.
  The token endpoint requires the same `redirect_uri`.
- **Codes and tokens:**
  - Codes are single-use. A code used twice revokes what it gave out.
  - Refresh tokens rotate; reusing one revokes the whole grant.
  - Tokens are stored as SHA-256.
  - Two approvals at the same time cannot both get a code.
- Errors before consent show a StudyHawk page instead of redirecting, so `/oauth/authorize` is not an open redirect.
- **Consent screen:** anyone can register an app with any name, so an app that does not send its code back to a known
  client (ChatGPT, Claude, localhost) is shown as **unverified**, with the address that would get the access.
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

- **No raw HTML:**
  - No `dangerouslySetInnerHTML`, `innerHTML` or `eval`.
  - Markdown runs without raw HTML, and `javascript:` links are dropped.
  - Every `target=_blank` link has `rel="noopener noreferrer"`.
- **Formulas and diagrams:**
  - Formulas are rendered by KaTeX (`trust: false`).
  - Mermaid diagrams use `securityLevel: 'strict'` with plain-text labels and are shown as an `<img>` of the SVG.
- Pictures in the agent's answers load only from the user's own files; other images become links. Otherwise a
  prompt injection could leak data in an image address.
- **Headers:**
  - `Content-Security-Policy` (scripts from our origin only);
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`;
  - `Cross-Origin-Opener-Policy: same-origin`;
  - `nosniff` and `X-Frame-Options: SAMEORIGIN`;
  - `Referrer-Policy: same-origin`;
  - a `Permissions-Policy` that allows only the microphone (dictation).
- Every absolute link (verification, reset, billing, OAuth issuer) is built from `PUBLIC_URL`, never from the Host
  header.
- nginx access logs record paths without query strings, so one-time tokens never reach the logs.
- The Vite dev server only serves files from `frontend/` and `locales/`, never the rest of the repo (`data/` holds the dev
  database and key).
- Password and login fields stop at the server's limits (`maxLength`).

## Deploying safely

The expected setup is: browser → Cloudflare (Tunnel) → Nginx Proxy Manager (TLS) → StudyHawk, on a private Docker network.

**StudyHawk**

- `NODE_ENV=production` (the image sets it; never override it).
- `PUBLIC_URL=https://...`, which makes the cookies `Secure` and `__Host-`. `MASTER_KEY` from a secret store, identical on
  every replica.
- A strong `ADMIN_PASSWORD` (12+ characters). Remove it from the environment after the first boot.
- Do not publish StudyHawk's port (no `-p 80:80`): put it, Nginx Proxy Manager and `cloudflared` on one Docker network
  (`docker network create edge`), and have the proxy forward to `http://studyhawk:80`. If you must publish, bind to
  `127.0.0.1`.
- `TRUST_PROXY` set to Nginx Proxy Manager's exact address on that network (for example `172.30.0.2`), not
  `uniquelocal` and not `cloudflare`. Under a Tunnel, Cloudflare's IPs never connect to you, and if the origin were
  reachable those ranges would let any Cloudflare customer forge the client IP.
- `CLIENT_IP_HEADER=cf-connecting-ip`: Cloudflare sets that header itself and overwrites what the visitor sent, so rate
  limits use the real address even if a proxy in between trusts a forged one.
- Postgres on a private network with a strong password; `DB_SSL=true` when it is on another machine.
- Encrypt the disks or volumes that hold Postgres and `/data`, and encrypt backups. Chats, memories and files are not
  encrypted by the application (see the open items).
- Mount `/data` on the backend with `nosymfollow` (Linux 5.10+). This is the strongest guard against links planted
  by the sandbox.
- Put `/data` on its own disk or volume, so a full workspace cannot fill the database's disk.
- Deploy a pinned image tag or digest, not `:latest`.

**Nginx Proxy Manager** (each proxy host behind Cloudflare)

- Forward to `http://studyhawk:80`, with "Block Common Exploits" on. Force SSL and HSTS on, with a Cloudflare Origin
  Certificate or a Let's Encrypt DNS certificate.
- Its stock config trusts `X-Real-IP` from private addresses, and `cloudflared` connects from one. A visitor could then
  pick their own IP. In the Advanced tab:

  ```nginx
  real_ip_header CF-Connecting-IP;
  real_ip_recursive off;
  client_max_body_size 100m;
  proxy_buffering off;
  proxy_request_buffering off;
  proxy_read_timeout 3600s;
  proxy_send_timeout 3600s;
  ```

- Leave its access log off, or use a format without the query string (one-time tokens travel in links).
- Set the default site to "No response (444)", so unknown hostnames get nothing.

**Cloudflare**

- Tunnel only. If the origin's IP was ever in a DNS record, change it or firewall it.
- SSL/TLS "Full (strict)", Always Use HTTPS, minimum TLS 1.2, HSTS with `includeSubDomains`.
- **Cache rule:** bypass the cache for `/api/*`, `/mcp*`, `/oauth/*`, `/.well-known/*`, `/sw.js` and `/index.html`.
  Never "Cache Everything" on HTML or the API.
- Turn off Rocket Loader, Email Obfuscation, Auto Minify and any script injection (Zaraz, Web Analytics). They break the
  CSP.
- **Edge protection:**
  - WAF rate limiting rules on `POST /api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password`, `/api/contact`
    and `/oauth/register`.
  - Turnstile or Bot Fight Mode if sign-ups are abused.
  - Cloudflare Access in front of `/admin` and `/api/admin/*`.

**Development**

- The dev compose binds Postgres and the balancer to `127.0.0.1` only.
- Never route a public hostname to `npm run dev` (the Vite dev server).

## Open items

These are known and not fixed in code yet, most severe first.

1. **Prompt injection can send data out.**
   - **Where the agent can be steered from:** text in a Canvas page, an email, a web page or an uploaded file.
   - **What it can do without approval:** run code (`code_run`), fetch a URL (`web_fetch`), open a page
     (`browser_open`) or schedule a task (`cron_create`). Sandbox code reaches the internet freely, and through it the
     host's network: LAN services, cloud metadata (169.254.169.254), the Docker host.
   - **Fixes:**
     - an egress proxy or `DOCKER-USER` iptables rules on the sandbox bridge that drop RFC 1918, link-local, CGNAT
       and the host gateway;
     - an allow-list of outbound hosts (`sandbox.network_list`);
     - approval for outbound requests carrying data from tools.
2. **The sandbox can read the browser profiles.** Chromium profiles, with the student's Outlook and SSO cookies, live in
   `/workspace/.browser`, and user code runs as the same uid as the runner. Code could also read the runner token from
   `/proc/<pid>/environ`.
   - Fix: mount the profiles outside the workspace, owned by the runner only (mode 0700); run user code as a second uid;
     pass the token through a file that is read once and deleted. Better: a browser container that never runs user code.
3. **The web container holds the Docker socket.** The backend runs as uid 1000 (the entrypoint drops to it after
   setting up `/data` and the socket's group; only nginx's master stays root), so nothing it does on `/data` runs as
   root. But access to the socket is still root on the host: a remote code execution flaw in the backend would mean
   root on the host and every user's data.
   - Fix: a separate sandbox service, or a socket proxy that only allows container create/start/stop, plus
     `--cap-drop ALL --read-only`.
4. **Content is plaintext at rest.** Chats and tool results (emails, Degree Works, Canvas), memories, approvals and files
   are readable by anyone with a database dump or a copy of `/data`. Until there is application-level encryption (a
   per-user key wrapped by `MASTER_KEY`), encrypted volumes and backups are a hard requirement.
5. **No key rotation, and ciphertexts are not bound to their row.** A leaked `MASTER_KEY` cannot be rotated without every
   student entering their secrets again. Someone with write access to the database could swap two ciphertexts.
   - Fix: a key id in the ciphertext, a keyring, and AES-GCM additional data with the table, row and user id.
6. **Remaining TOCTOU windows.** `list`, `stat`, `mkdir` and the rename after an upload can still be raced by a link swap
   in a parent folder; delete, move and copy leave only a narrow window. `nosymfollow` closes them.
7. **Sandbox disk is checked only before and after a run.** One run can fill the shared disk.
   - Fix: XFS project quotas or a per-user volume, or watch usage during the run and stop it.
8. **Uploads across replicas.** The in-flight reservation is per replica; two replicas can still each accept
   a parallel upload past the quota (bounded by 100 MB per upload).
9. **Open event streams** (chat SSE, admin log tail) are not re-checked after logout or demotion until they
   reconnect.
10. **Lockout by name.** Anyone can block a student's login for 15 minutes with 10 wrong guesses, and their password reset
    for an hour. The user name and the email also count separately.
11. **Accounts can be guessed at sign-up.** Signing up with an address that already has an active account answers
    "already taken".
12. **Supply chain.** Dependabot merges minor and patch updates on its own, and pushes to main publish `:latest`.
    - Fix: a 7-day cooldown on updates, deploying pinned tags, and `npm ci --ignore-scripts`.
13. **No two-factor sign-in, and no list of signed-in devices.** An admin can reset a student's password and then sign in
    as them.
14. **Third parties:** beta bug reports send the tester's name, email, page and screenshot to Discord.
15. **Leftovers after a purge:** usernames in `audit_log` metadata and `codex_failures` are not pruned, and backups keep
    deleted rows until they expire.
