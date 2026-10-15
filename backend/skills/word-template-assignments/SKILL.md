---
name: Word Template Assignments
description: Use when a Canvas assignment requires a Word (.docx) deliverable, such as filling a template, adding required images, or turning an outline into a report draft for the student's review.
---
# Word Template and Report Assignments

Workflow for assignments whose deliverable is a Word `.docx`: a template to complete, or a report to write. You prepare and format; the student authors and submits. Canvas is read-only for you: never submit.

## Academic integrity (check first)
1. Read the assignment text for any academic integrity or AI-use language BEFORE writing substantive content.
2. If AI-generated ideas or text are prohibited, or the task needs the student's own observation, experience or wording: do NOT write submission-ready prose. Prepare the template, fill only objective administrative fields the student gave you, insert clearly labeled placeholders, and create a separate checklist/outline telling the student what they must personally write, observe or draw. Label the file a working template, not a ready-to-submit draft.
3. If AI help is allowed, work from the student's own material (their outline, notes, prior draft, answers to your questions) and expand it; never invent personal stories, team contributions, dates, locations, photos or results. Mark unknowns `PENDING VALIDATION`.

## Workflow
1. **Inspect Canvas.** `canvas_assignment` for description, rubric, points, due date, submission type. Note links to files in the description.
2. **Find the template.** Look in `canvas_modules` and `canvas_files`, then `canvas_download` it. If the course file list is restricted, files linked from the assignment may still be reachable; say what you could not access.
3. **Preserve the original.** Keep the downloaded template unchanged. Work on a copy named clearly, e.g. `<Student Name> <Assignment> - DRAFT FOR VALIDATION.docx`, in `<term>/<course>/assignments/<slug>/`.
4. **Collect grading sources before writing a report:** assignment, rubric, handout, the student's earlier outline/draft, and course notes (`rag_ask` / `rag_search` if the course has a RAG). Align every required heading with the rubric.
5. **Fill the document with `code_run` and python-docx.** Prefer editing existing paragraphs/tables so the template formatting survives:
```python
from docx import Document
doc = Document("template.docx")
for p in doc.paragraphs:
    if "Name:" in p.text:
        for r in p.runs[1:]: r.text = ""
        p.runs[0].text = "Name: <student name>"
for t in doc.tables:
    t.cell(0, 1).text = "..."
doc.save("<Student Name> <Assignment> - DRAFT FOR VALIDATION.docx")
```
   Images: `doc.add_picture(path, width=Inches(4))` or add to a run. If a selfie, drawing, scan or photo is required and not provided, insert a clearly labeled placeholder and tell the student to replace it.
6. **Citations (reports).** Cite inside the body for external facts and course concepts, not only in the reference list. When page numbers are unavailable cite real chapters/sections; never fabricate pages. Check every reference against the claim it supports and drop sources you cannot access or confirm. Check author/date identity; use letter suffixes (2026a/2026b) for same author and year; for 3+ authors use "et al." in-text and list all in the reference entry. Word recommendations and inferred risks as the student's analysis, not as sourced facts.
7. **User wording overrides defaults.** If the student corrects an answer, change it exactly as they say.
8. **Verify the `.docx`.** Reopen with python-docx and check: expected strings, headings, word count, images present, no stale `TODO`/`Draft`/`Textbook citation to add`, and that unknowns are marked `PENDING VALIDATION`.
9. **Report.** Give the file path and list only what remains before submission: items to write, replace or confirm. State that submission is for the student to do in Canvas.

## Checklist
- [ ] Policy on AI/integrity checked; output matches it.
- [ ] Original template untouched; output copy has a distinct name.
- [ ] Unknown personal facts marked, not invented.
- [ ] Required image present or a labeled placeholder.
- [ ] Headings and citations match the rubric; references verified.
- [ ] File reopened and checked; no claim of Canvas submission.
