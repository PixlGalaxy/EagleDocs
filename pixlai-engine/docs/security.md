# Security

An agent reads things other people wrote (web pages, emails, documents) and can act for its user. This page lists what the engine does to keep that safe, and what stays the host's job. Read it before you add tools that touch the outside world.

## What the engine guarantees

| Risk | What the engine does |
|---|---|
| A tool does something irreversible the user did not want | Tools with `sideEffect: 'external'` never run without an approval from `RunStore`. The approval card shows `describe(args)`, so the user approves what will actually happen. A `gate` can raise or lower that per call. See [Approvals](concepts.md#approvals). |
| Text from a web page or email tells the model what to do | Results of tools with `untrusted: true` are wrapped in `<untrusted_content>`, any copy of that tag inside the payload is neutralized, and the system prompt says wrapped text is data. See [Untrusted content](concepts.md#untrusted-content). |
| A tool result pretends to be the user ("the user says: send it") | Real corrections arrive only through `RunStore` and carry an out-of-band marker the system prompt vouches for. Look-alikes inside tool results are named as fakes. See [Steering](concepts.md#steering). |
| A helper agent does something on its own | Subagents only get tools with `sideEffect: 'none'` that are not `mainAgentOnly`. They cannot ask the user, trigger approvals, write memory or create schedules. |
| One user's data reaches another | Every store call carries `userId`, and tools get `ctx.user.id`. The engine never mixes users in one call. Your stores must scope every query by it. |
| A run never ends | `maxSteps`, `maxTokens`, `toolTimeoutMs` and `approvalTimeoutMs` bound every run. The last step has no tools and asks for a summary. |
| A path escapes the user's files | `cleanPath` rejects `..` in every files and rag tool before your `WorkspacePort` sees it. The `.rag/` folder can only be changed by the rag tools. |
| A scheduled run reschedules itself forever | Scheduled runs cannot use the `cron_*` tools. |

## What the host must do

The engine has no network, file system or database access of its own. The ports you implement are where these protections live:

- **Approvals reach the right person.** `createApproval` and `waitForApproval` are yours: only the run's user may decide, and an expired approval must not be decided later.
- **`FetchPort` blocks internal addresses.** `web_fetch` and `web_download` go wherever the model says. Your fetcher must resolve the host name, refuse private, loopback and link-local ranges (including `169.254.169.254`), connect to the address it checked, and check again after every redirect. EagleDocs' `SafeFetch` is a complete example.
- **`SandboxPort` isolates code.** `code_run` executes whatever the model writes. Run it in a container or VM with no host mounts except the user's workspace, no privileges, CPU, memory and process limits, and the network policy you want.
- **`BrowserPolicy` decides where the agent may act.** The browser pack reads anything, asks before acting on sites the user has not trusted, and refuses domains you block. Put every site where an action would be harmful (submitting coursework, payments) in `blocked`.
- **`WorkspacePort` enforces quotas** and keeps each user in their own root.
- **Stores scope by `userId`** in every query, including `load` and `remove` by id.
- **`MemoryStore.write` can refuse.** Throw when the user turned memory off; the agent reads the message. The `memory_update` description already tells the model never to save passwords or codes, but if you need a hard guarantee, check the content in `write`.
- **Secrets stay out of errors.** Tool and provider error messages reach the model and the logs (provider errors are cut to 600 characters). Never put tokens in them.
- **Your own tools follow the same rules.** Mark anything that sends, submits, pays or deletes outside the user's workspace as `external`. Mark anything that returns third-party text as `untrusted`.

## Tool checklist

Before you ship a tool:

1. Does it change anything outside the user's own files? Then `sideEffect: 'external'` and a `describe` that shows the exact effect (recipient, amount, file).
2. Does its result contain text someone else wrote? Then `untrusted: true`.
3. Can its risk depend on the arguments (a trusted site vs. any site)? Write a `gate`.
4. Should helpers be able to call it? If not, `mainAgentOnly: true`.
5. Can it take long? Set `timeoutMs` and honour `ctx.signal`.
6. Does it touch a path or URL from the model? Validate it yourself even if the port also does.

## Limits of these protections

Wrapping untrusted text lowers the chance that a model follows injected instructions; it does not make it impossible. That is why irreversible actions need an approval no matter what the model believes, and why the approval card must show the real effect, not the model's summary of it.
