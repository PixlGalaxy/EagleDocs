# Changelog

All notable changes to PixlAI-Engine. The engine is pre-1.0: minor versions can change the API, and every breaking change is listed under **Breaking**.

## Unreleased

### Breaking

- **Memory is now three markdown files per user (Hermes style).** `MemoryStore` is `read(userId)` / `write(userId, doc, content)` over `soul` (SOUL.md, the agent's personality), `user` (USER.md, who the user is) and `notes` (MEMORY.md, the agent's own notes). All three go into every conversation. `memory_add`, `memory_search` and `memory_remove` are replaced by one `memory_update` tool that applies a batch of add / patch / remove / replace within a size limit. `MemoryItem` and `forPrompt` are gone. New limits `soulChars`, `userChars`, `notesChars` (3000, 1500, 2500). To migrate, join each user's old facts with `\n§\n` into their USER.md.
- `skills_load` returns `lessons_learned` before `instructions`, so a long skill can never cut the user's notes off.
- `subagent` events carry `model_label`.

### Added

- **Questions with options.** `ask_user` takes 1 to 4 `questions`, each with 2 to 4 options (`multi_select` optional); `RunResult.questions` and a `questions` event let hosts show them as choices. `content` keeps a text version. The free-text `question` still works.
- **`show_html`** (with `EngineOptions.displays: ['html']`): the agent shows an interactive page in the conversation; pages come in `RunResult.displays` and a `display` event.
- Tool cards are smaller: `ToolCallView.args` clips texts over 2,000 characters, and a tool's optional `view(args)` decides what its card shows.
- `SearchChain`: one `SearchPort` over several providers (next one on a failure or no results; failed providers cool down). `SearchPort` options carry `userId`, so a provider can act per user.
- `web_fetch` reads pages drawn by JavaScript and pages behind a bot check (403, 429, 503) in the user's browser when a `BrowserPort` is configured.
- `RunOptions.notes` (and `SubagentRunOptions.notes`): context only the host knows, added to this run's system prompt and inherited by helpers, e.g. the folder where a conversation keeps its files.
- `RunOptions.reasoning` (`ReasoningLevel`) reaches `ModelRequest.reasoning`, so hosts can offer a thinking selector.
- `compactHistory` for compaction on demand: the host stores the summary and sends it before the kept messages.
- `UserAgent.callTool(name, args)` runs one tool outside a conversation (for MCP servers and other hosts), with the same context, gates, timeout and untrusted wrapping; tools that need an approval are refused.
- **Images in user messages.** `ChatMessage.images` reach models with `ResolvedModel.supportsVision`; other models get a note with the file name so tools can open it.
- `context` event before each model call with the estimated prompt size and the window.
- **Model per helper.** `RunOptions.helperModels` lists the models the agent may give its helpers, with guidance to match the model to the work (`fast`, `smart`, `code`). Each `agent_delegate` task can set `model`; unknown choices fall back to the parent's model. Reports say which model wrote them.
- **Background delegation.** With `RunOptions.startBackground`, `agent_delegate` accepts `background: true`: the run answers right away and the host runs the helpers later with `UserAgent.runSubagents`, then hands the reports back with `backgroundReportMessage`.
- **Retries for dropped model connections.** A stream cut mid-answer, a 5xx, or a 429 other than `usage_limit_reached` is retried after 1 s and 4 s. Text already shown is cleared with an `interrupted` event first.
- **Empty replies retried once** with a nudge that is not stored in the conversation.
- `mfa_required` event and `waiting_mfa` status for tools that wait on a sign-in approval on the user's phone.
- `describe(args, ctx)` can be async and read host data, so approval cards show what will really happen.
- Code, web and browser packs: `code_run` over a `SandboxPort` (Python by default), `web_search` / `web_fetch` / `web_download`, and the `browser_*` tools with a `BrowserPolicy`. Per-tool `gate` and `timeoutMs`.
- `rag_add` resumes where it stopped, skips files it already indexed and near-duplicates, and reuses vectors.
- Documentation: [Security](docs/security.md), [Skills](docs/skills.md), [Recipes](docs/recipes.md) and the [API reference](docs/reference.md).

## 0.1.0

First version: multi-user tool-calling loop with live steering, approvals for external actions, parallel subagents, cron schedules, memory, skills, a per-user file workspace with quotas and a `TEMP/` area, RAG over documents, context compaction at 75% of the window, and in-memory stores. No runtime dependencies.
