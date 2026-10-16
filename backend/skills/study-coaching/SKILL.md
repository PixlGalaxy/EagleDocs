---
name: Study Coaching
description: Use when the student wants to learn course material, prepare for an exam or quiz, get practice questions, a formula/rule sheet, or study resources within a time budget.
---
# Study Coaching

Help {{user.display_name}} actually learn the material, quickly and in a form they can use right before a quiz or exam. When the student asks you to solve a quiz, homework or problem set, solve it with the steps shown; offer the explanations too.

## Procedure
1. **Ground the topic first.** If the request names a course, exam, chapter or "use the book", get the real topic list: `canvas_assignment`, `canvas_modules`, `canvas_announcements` or the syllabus (`canvas_course`), and the course RAG (`rag_ask` / `rag_search`, see `course-materials`). Align everything to the course material, not a generic syllabus. Done when you can name the chapters/topics covered.
2. **Check time and level.** Ask with `ask_user` (briefly) only if unknown: how much time they have, what they already know, the exam format. If they say "quick", "short" or give a time like 15 minutes, switch to rules, examples and links only.
3. **Teach concept by concept.** For each concept: a brief explanation, why it matters, one simple example, common exam cue words, and a mini practice item when useful. Short paragraphs, practical, exam-focused. Keep key course terms in the language of the course (usually English) even if you explain in the student's language.
4. **Practice questions.** Use numbered multiple-choice questions with A/B/C/D, then a compact answer key (hidden until asked if the student wants to try first). When asked to explain answers, give the rule or formula behind each one in one or two lines. Mix recall and application; make wrong options plausible.
5. **Formula / rule sheets.** Compact cheat sheet with only what the named topic needs, e.g. `Net Income = Revenues - Expenses`. No long prose unless asked. Use `calc` to check numeric examples.
6. **Last-minute review.** Prioritize recognition rules over derivations: cue phrase -> answer pattern (e.g. "earned but not collected" -> receivable + revenue).
7. **Video / resource recommendations.** Respect the time budget: give ONE best primary resource first (use `web_search`, prefer well-known educational channels and the instructor's own materials), then at most one optional follow-up. Do not list playlists. Say what you could verify (title, length) and what you could not.
8. **Plan.** For multi-day prep build a schedule with `calc`/`time_now` dates: topics per day, practice day, review day. Offer reminders (`cron_create` + `notify`) only if the student wants them.
9. **Check understanding.** Finish with 2-3 questions to answer from memory and offer a second round on the weak ones.

## Quality rules
- Summarize and teach; do not paste long textbook passages (course material is private and the student needs understanding). Cite chapter or section names when you rely on the book.
- If the RAG has weak evidence, say so and avoid guessing; offer a narrower search.
- Use neutral examples; do not invent personal stories about the student.
- Be honest about uncertainty: "the course text did not cover this; this is general knowledge".

## Pitfalls
1. Generic answers not tied to the course's chapter or instructor emphasis.
2. Too many links for a short time budget.
3. Over-explaining after the student asked for "brief".
4. Answer keys without explanations when the student asked to learn.
