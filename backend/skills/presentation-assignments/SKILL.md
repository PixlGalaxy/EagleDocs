---
name: Presentation Assignments
description: Use when the student needs to plan or build a class presentation (.pptx) from a Canvas prompt or professor handout, including slide outline, speaker notes and verification.
---
# Presentation Assignments

Build {{user.display_name}}'s class presentation as a finished .pptx in the workspace: content, structure, speaker notes and formatting. Never invent personal stories, data or sources, and do not submit the deck (Canvas is read-only for you).

## Ground rules
- If the assignment's own text or syllabus forbids AI help, mention it once in a short line; then do what the student decides.
- Build the complete deck; use the student's notes or choices when they give them (`ask_user` for a topic choice the prompt leaves to them).
- Cite sources that exist. Mark unverified facts as `PENDING VALIDATION`.

## Procedure
1. **Gather the full context.** `canvas_assignment` for prompt, rubric, points, due date, submission type; then `canvas_modules` / `canvas_files` for handouts, tip sheets, outlines or example decks (the real structure is often in a separate .docx/.pptx). `canvas_download` them with `course_id` (they land in the course's `Canvas/` folder) and read them (see `documents`). Build the deck in `Work/<assignment>/`; the finished file goes in `Assignments/`.
2. **Choose the subject to match the rubric.** If the prompt asks for one company, case or topic, anchor the deck to one primary subject; use other ideas only as comparison or motivation.
3. **Map slides before writing.** Build a slide-by-slide outline directly from the required sections. A stated slide limit is the TOTAL deck count (title slide included) unless the prompt explicitly excludes title/reference slides. "5 slides" means exactly 5.
4. **Write lean slides.** Short bullets, one idea per slide, at most about 6 bullets and 12 words per bullet. Put the fuller spoken text in speaker notes. Keep the student's own level of English and voice.
5. **Build the .pptx with `code_run` and python-pptx.** Pattern:
```python
from pptx import Presentation
from pptx.util import Inches, Pt
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)
def add(title, bullets, notes=""):
    s = prs.slides.add_slide(prs.slide_layouts[1])
    s.shapes.title.text = title
    tf = s.placeholders[1].text_frame
    tf.clear()
    for i, b in enumerate(bullets):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = b; p.font.size = Pt(24)
    s.notes_slide.notes_text_frame.text = notes
add("Title", ["point one", "point two"], "what to say")
prs.save("<term>/<course>/assignments/<slug>/<Student Name> - <Assignment> - DRAFT.pptx")
```
   Use readable fonts (24 pt body, 36+ pt titles), strong contrast, consistent layout, images only if licensed or provided; add matplotlib charts via `slide.shapes.add_picture` when data helps.
6. **Companion script.** Save a short Markdown speaker script beside the deck when helpful for practice, with timing per slide.
7. **Verify before saying it is ready.** Re-open the file with python-pptx and check: exact slide count, each slide's title/text, notes present on every slide, no leftover placeholder text unless intended, file size. If you can render images of slides, inspect them; otherwise say visual rendering was not checked.
8. **Report.** Give the path, the slide list, what is placeholder or pending, and what the student must still do (review, rehearse, submit themselves).

## Pitfalls
- Counting slides wrong against the professor's limit.
- Splitting a one-company assignment across several companies.
- Reading only the Canvas body and missing the handout with the outline.
- Claiming the deck is verified without reading it back.
- Dense text walls on slides.
