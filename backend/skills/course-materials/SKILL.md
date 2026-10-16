---
name: Course Materials (RAG)
description: Use when the student wants to ask questions about, search or study from a course's books, slides, readings or files, or wants those materials downloaded from Canvas and indexed per course.
---
# Course Materials and Course RAGs

Download course materials from Canvas, index them into one knowledge base (RAG) per course, and answer from them with citations. Canvas is read-only: you only download, never upload or change anything there.

## Folder convention
Each course of this term already has its folder (`canvas_courses` gives it as `folder`, e.g. `Fall 2026/Intro to Marketing/`):
- `Canvas/` downloaded files and saved pages (originals; download again to refresh them)
- `Work/` work in progress (code, data, drafts); `Work/<assignment>/` for one assignment
- `Assignments/` finished work ready to submit
- `Notes/` summaries, study guides, flashcards
Use those folders; do not create others for the same course. One-off downloads go in `TEMP/`.

## Step 1: Find and download
1. `canvas_courses` -> pick the course; `canvas_modules` and `canvas_files` show readings, slides and handouts.
2. `canvas_download` the files you need with `course_id` (they land in the course's `Canvas/` folder). Use `canvas_save_pages` with `folder` set to that `Canvas/` folder to save module pages, syllabus and page content as text.
3. Check size first with `files_usage` when downloading many large files; tell the student if space is short.

## Step 2: Triage before indexing
Never index blindly. For each file or e-book, open or sample it (see `documents`) and decide:
- **Readable text** (text PDFs, DOCX, PPTX, saved pages): index it.
- **E-book readers** reached only through publisher platforms (McGraw, VitalSource, Yuzu, etc.): you can only index what can be downloaded as a file or saved as text. If the reader is image-heavy or exposes only buttons and page counters, do not create a RAG from it. Tell the student plainly: the book is shown as page images, so a text RAG is not possible; offer section-by-section help from files or pages they provide. Never log in to publisher sites with the student's credentials.
- **Scanned PDFs** (pages with almost no text): report them and exclude them; there is no OCR.
- Spot-check several pages: they must contain real course prose, not only a table of contents, navigation text, repeated headers or tiny snippets.

## Step 3: Build the RAG
1. `rag_list` to see existing RAGs. Reuse the course RAG if one exists; avoid duplicates.
2. `rag_create` (one per course, named like the course, e.g. "Intro to Marketing") then `rag_add` for each readable file or saved page. Add the chapter/title in the source name when possible so citations are meaningful.
3. Verify: run one `rag_search` with a topic you know is in the material and confirm the hits come from the right files. If a sample returns navigation text or the wrong source, remove the bad source or the whole RAG with `rag_delete` rather than leaving a misleading index.
4. Tell the student what was indexed (files, count) and what was skipped and why.

## Step 4: Answer
- Use `rag_ask` for direct questions and `rag_search` when you need the raw passages (to quote carefully, compare sources, or for a chapter-specific question).
- Cite sources by file and chapter/page/section as returned. If evidence is weak or the retrieval drifted to other chapters, say so and retry with a narrower query naming the chapter.
- Say "the course materials do not cover this" instead of filling gaps from general knowledge; if you add general knowledge, label it.
- Do not paste long passages. Summarize, quote briefly, and point to the source location. The material is private study content.
- For study methods and practice questions use `study-coaching`.

## Step 5: Cleanup
- When the student asks to delete the downloaded originals, delete them with `files_delete` (only the files they name or the `Canvas/` folder of that course; confirm the list first). The RAG stays and keeps working; tell the student that the original files will no longer be available to open.
- Remove a RAG only when asked (`rag_delete`).

## Honest reporting
State exactly what is in the knowledge base. Do not claim a book is "fully indexed" if only some chapters were available. If a download failed (permissions, missing file), report it and continue with the rest.

## Pitfalls
1. Assuming a reader that opens means text can be extracted.
2. Indexing navigation text or the table of contents repeatedly.
3. Leaving failed or partial RAGs around that later look valid.
4. Creating duplicate folders or RAGs for the same course.
5. Deleting originals without the student's explicit request.
