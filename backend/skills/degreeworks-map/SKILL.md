---
name: Degree Works Map
description: Use when the student asks for a degree map, remaining requirements, graduation planning, credits left, or what classes to take next, based on their Degree Works audit.
requires: degreeworks
---
# Degree Works Map

Build a practical, visual degree map for {{user.display_name}} ({{user.major}}) from their {{institution.name}} Degree Works audit ({{institution.degreeworks_url}}). Degree Works is the source of truth for requirements. Canvas only informs current-course workload; never substitute it for the audit.

## Rules
- Never ask for passwords or Duo codes. When `degreeworks_audit` needs to sign in, a Duo/MFA prompt appears automatically: tell the student to approve it on their phone, then continue.
- Do not claim access worked until the audit text was actually saved and read. If the site blocks access, report the observed blocker and stop; do not guess requirements.
- The result is a planning aid, not official advising. Say so, and list what to confirm with an advisor.
- Keep "choose X from Y" groups as written; do not invent a single course.

## Procedure
1. Call `degreeworks_audit`. It signs in, expands the audit, saves its text to `Degree Works/audit-<date>.txt` in the workspace and returns a preview.
2. Read the whole saved file with `files_read` (or `code_run` if it is long). The preview is not enough.
3. Parse and separate into: completed, in progress, remaining required, choice groups / electives, and uncertain items. Capture credits earned, in progress, required and remaining; GPA and major/minor/concentration blocks when visible; holds or notes.
4. Verify the numbers: totals by block should add up to the overall credits. Use `calc` or `code_run`; state mismatches rather than hiding them.
5. Prerequisites and offering: only use what the audit or catalog shows. You may check the catalog with `web_search` / `web_fetch` and cite the page. If a plan depends on a course being offered in a given term, label it an assumption.
6. Build the map file with `code_run` and save to `Degree Works/degree-map-<date>.html` (preferred: one self-contained HTML, no external scripts). Include:
   - Header: program, credits done / in progress / remaining, progress bar.
   - Blocks (General Education, major, minor, electives...) as cards with each requirement coloured by status (done, in progress, remaining, needs review).
   - Prerequisite chains where known (simple arrows or "unlocks" lists).
   - A term-by-term plan table.
   If HTML is not suitable, produce a PNG with matplotlib or a PDF with reportlab in the same folder.
7. Read the generated file back (size, key strings) to verify it exists before saying it is ready.
8. Tell the student where the file is and summarize in chat.

## Plan guidance
- Use realistic loads (typically 12-15 credits per regular term; ask the student about summer, max credits, work hours).
- Put prerequisites and "gateway" courses early; flag courses that unlock many others.
- Respect transfer/AP credits only if the audit shows them.
- Count in-progress courses as finished only in the projection, and label that.
- If graduation date matters, compute remaining credits / planned credits per term with `calc`.
- Ask with `ask_user` for preferences (target graduation term, summers, credit load) before building the final plan when they are unknown.

## Final answer format
```markdown
## Degree map summary
- Program / audit date:
- Credits: completed X, in progress Y, remaining Z
- Remaining requirement count:

## Remaining requirements by category
| Category | Requirement | Status | Notes |
|---|---|---|---|

## Recommended next term
| Priority | Course | Why now | Notes |
|---|---|---|---|

## Term-by-term plan
| Term | Courses | Credits | Rationale |
|---|---|---:|---|

## Confirm with your advisor
- ...

## Assumptions and risks
- ...

Map file: Degree Works/degree-map-<date>.html
```

## Checklist
- [ ] Audit file saved and fully read.
- [ ] Every unmet block appears in the map or is marked "needs advisor review".
- [ ] Confirmed audit data is separated from assumptions.
- [ ] No credentials requested or stored.
- [ ] Map file exists in the workspace and was read back.
- [ ] If a sign-in failed, the blocker was reported and no requirements were guessed.
