# Workspace, files and RAG

Two optional tool packs give the agent a place to keep files and a way to answer
questions from large documents without reading them into the conversation:

- **files pack**: `files_list`, `files_read`, `files_write`, `files_mkdir`,
  `files_move`, `files_delete`, `files_search`, `files_usage`. Enabled when you
  pass a `workspace`.
- **rag pack**: `rag_list`, `rag_create`, `rag_add`, `rag_search`, `rag_ask`,
  `rag_delete`. Enabled when you pass a `workspace` **and** `embeddings`.

```ts
import { createEngine, InMemoryWorkspace } from 'pixlai-engine';

const engine = createEngine({
  stores,
  basePrompt,
  workspace: new InMemoryWorkspace(),   // or your own WorkspacePort
  extractor: myExtractor,               // optional: PDF/DOCX/PPTX... to text
  embeddings: myEmbeddings,             // enables the rag pack
  sharedRags: mySharedSource,           // optional: read-only RAGs from others
});
```

The engine never touches a disk, a vector database or an embedding vendor. It
works through four ports, described below.

## The typical flow

What the packs are designed for (and what StudyHawk does with course material):

1. Bring documents into a temporary area. In StudyHawk a Canvas tool downloads
   them into `TEMP/`.
2. `rag_create` a collection, then `rag_add` the files or whole folders. Text is
   extracted, split into chunks of 1,200 characters with 200 of overlap, and
   embedded in batches of 32.
3. Delete the sources (`files_delete`) or let the temporary area expire. **The
   RAG keeps the text**, so it no longer needs the originals.
4. Answer with `rag_ask` (a separate model call that sees only the best
   passages and returns an answer with citations) or `rag_search` (the raw
   passages, for the agent to read itself).

`rag_ask` keeps the conversation short: the passages go to a side call made with
the run's own model (`ToolContext.complete`), and only the answer and its
sources come back.

## WorkspacePort

A user's files. Paths are always relative to the user's own root, use `/`, and
never contain `..` (the tools reject it before calling you). Your
implementation maps them to real storage, enforces quotas and refuses anything
that escapes the root (symlinks included).

```ts
interface WorkspacePort {
  describe(userId: string): Promise<string>;
  list(userId: string, path: string): Promise<FileEntry[]>;
  stat(userId: string, path: string): Promise<FileEntry | null>;
  read(userId: string, path: string): Promise<Buffer>;
  write(userId: string, path: string, data: Buffer | string, options?: { append?: boolean }): Promise<void>;
  mkdir(userId: string, path: string): Promise<void>;
  move(userId: string, from: string, to: string): Promise<void>;
  delete(userId: string, path: string): Promise<void>;
  usage(userId: string): Promise<StorageArea[]>;
}
```

| Method | Contract |
|---|---|
| `describe` | Text for the system prompt (`## Workspace` section): layout, quotas and rules. This is how the model learns that, say, `TEMP/` is wiped after 24 hours. |
| `list` | Direct children of a folder (`""` is the root). Throw if it is missing or not a folder. |
| `stat` | `null` when the path does not exist |
| `read` | Whole file contents |
| `write` | Create parent folders as needed. Throw when the quota would be exceeded; the message reaches the model. |
| `mkdir` | Recursive; no error if it already exists |
| `move` | Rename or move, across areas too |
| `delete` | Folders go with their contents |
| `usage` | One `StorageArea` per area: `{ name, usedBytes, limitBytes, note? }`. `note` is a rule for the model, e.g. "files here are deleted 24 h after their last change". |

Areas are your choice. StudyHawk maps `TEMP/...` to a second directory with its
own 10 GB quota and a sweeper that deletes each file 24 hours after its last
change. Everything else lives in the 5 GB workspace. The engine only sees paths
and the text from `describe` and `usage`.

The folder `.rag/` (exported as `RAG_DIR`) holds the user's RAGs and counts
against their quota. The files tools refuse to touch it, so the agent cannot
corrupt an index by hand. Hide it in your own file browser too.

`InMemoryWorkspace(limitBytes?, note?)` implements the port in memory, for tests
and demos.

## TextExtractor

```ts
interface TextExtractor {
  extract(data: Buffer, filename: string): Promise<{ pages: string[] } | null>;
}
```

Turns a document into text, one string per page (or slide). Return `null` for
formats you do not handle. The engine asks the extractor first and falls back to
reading the bytes as UTF-8 when the file looks like text (`.md`, `.txt`, `.csv`,
`.json`, code...). Pages matter: `files_read` takes a `page` argument and RAG
citations include the page number.

StudyHawk' extractor, as a reference: PDF with `unpdf` (`mergePages: false`),
DOCX with `mammoth`, PPTX with `jszip` (slide text plus speaker notes, one page
per slide), and HTML by stripping tags.

## EmbeddingPort

```ts
interface EmbeddingPort {
  readonly model: string;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
```

- `model` names the embedding space. A RAG records the model it was built with;
  if the current `model` differs, `rag_add` and searches fail with a clear
  message, because vectors from different models cannot be compared. Rebuild
  the RAG in that case.
- Every vector from one model must have the same length. The engine normalizes
  them, so you do not need to.
- Calls come in batches of up to 32 texts. Pass `signal` to your HTTP client.

With Ollama this is a `POST /api/embed` with `{ model, input: texts }`, using a
model such as `nomic-embed-text` (768 dimensions). With an OpenAI-compatible API
it is `POST /embeddings`.

## SharedRagSource

```ts
interface SharedRagSource {
  list(userId: string): Promise<SharedRagInfo[]>;
  readFile(userId: string, id: string, file: 'manifest.json' | 'chunks.jsonl' | 'vectors.f32'): Promise<Buffer | null>;
}
```

Optional and read-only: collections someone else built for this user, such as
an instructor's RAG of the course textbook. `list` decides who sees what. The
agent sees them in `rag_list` as `shared:<id>` with `read_only: true`, can
search them and ask them questions, and cannot add to them or delete them. The
files use the same format as a user RAG, so you can build one with the rag pack
in an instructor's workspace and serve its three files.

## Storage format

Each RAG is a folder `.rag/<id>/` in the user's workspace. The id comes from
`ragId(name)`, for example "ACG 2021" becomes `acg-2021`.

| File | Contents |
|---|---|
| `manifest.json` | `{ id, name, description, model, dims, createdAt, updatedAt, sources: [{ path, pages, chunks, addedAt }] }` |
| `chunks.jsonl` | One `{ source, page, text }` per line |
| `vectors.f32` | Little-endian float32, `dims` values per chunk, in the same order as `chunks.jsonl`. Unit length. |

Search is a brute-force dot product over the vectors. That is fast up to the
cap of 50,000 chunks per RAG (several thousand pages). The format is plain on
purpose: any process can read it, and backups are just files.

`UserRags(workspace, userId)` gives you `list`, `exists`, `load`, `save` and
`remove` for your own screens (StudyHawk' Settings → RAGs uses it). `chunkPages`
and `ragId` are exported too.

## Tool reference

### files pack

| Tool | Purpose | Notes |
|---|---|---|
| `files_list` | List a folder, optionally recursive | Up to 500 entries. `.rag` is hidden. |
| `files_read` | Read a file as text | Uses the extractor for documents. Returns up to 15,000 characters per call with `next_offset` to continue; `page` reads one page. |
| `files_write` | Write or append text | Up to 1 MB per call |
| `files_mkdir` | Create a folder and its parents | e.g. `Fall 2026/ACG 2021` |
| `files_move` | Move or rename | Also how to keep something out of a temporary area |
| `files_delete` | Delete a file or folder | Frees space, e.g. sources after `rag_add` |
| `files_search` | Find by name, or by content in text files | Up to 50 hits |
| `files_usage` | Space used and left in each area, with its rules | |

### rag pack

| Tool | Purpose | Notes |
|---|---|---|
| `rag_list` | The user's RAGs and shared ones | |
| `rag_create` | New empty RAG with a name and description | |
| `rag_add` | Index files or folders | Up to 200 files per call. A changed file replaces its old chunks; unchanged ones are skipped (size and modified time are recorded). A file whose chunks are 90% identical to chunks of another indexed file is skipped as a copy ("Chapter 10 (1).pptx"), and identical chunks reuse their vectors instead of being embedded again. Embeds 4 batches of 32 at a time, saves progress every 20 s, and stops by itself before its 15-minute timeout with an `incomplete` note: calling it again with the same paths continues where it stopped. Reports `added` and `skipped` (with the reason) and emits a `notice` per file. |
| `rag_search` | Top passages for a query | Results are untrusted content |
| `rag_ask` | Answer a question from the best passages, with citations | Uses `ctx.complete` with the run's model |
| `rag_delete` | Delete a RAG | Shared RAGs cannot be deleted |

`files_*` and `rag_*` that change things are main-agent-only; reads are
available to subagents, so a subagent can research a RAG in parallel.

## Writing tools on top of the workspace

Your own tools get the ports in `ToolContext` (`ctx.workspace`, `ctx.extractor`,
`ctx.embeddings`, `ctx.sharedRags`). A download tool, for example, writes into
the workspace and lets the rag pack do the rest:

```ts
const download = defineTool<{ url: string }>({
  name: 'lms_download',
  description: 'Download a course file into TEMP/lms/ (deleted after 24 h). Then index it with rag_add.',
  parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
  sideEffect: 'none',
  timeoutMs: 10 * 60_000,             // downloads can take longer than the default 60 s
  async run(args, ctx) {
    const res = await fetch(args.url, { signal: ctx.signal });
    const name = new URL(args.url).pathname.split('/').pop() || 'file';
    await ctx.workspace!.write(ctx.user.id, `TEMP/lms/${name}`, Buffer.from(await res.arrayBuffer()));
    return { path: `TEMP/lms/${name}` };
  },
});
```
