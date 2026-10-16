# Skills

A skill is a set of step-by-step instructions for one kind of task ("build a degree map", "triage my inbox"). The agent sees a one-line index of every skill it has, and loads the full instructions only when a task needs them. That keeps the system prompt small while the agent still knows a lot of procedures.

## How the agent uses them

1. The system prompt lists each skill as `slug: name. description`, with the rule "before doing a task that matches one, even partly, load it with `skills_load` and follow it". The index is only added when the model can use tools.
2. `skills_load({ slug })` returns `{ name, lessons_learned, instructions }`. Lessons come first so a long skill never pushes them out of the result.
3. While working, the agent can record what it learned for this user with `skills_note({ slug, note })` (up to 300 characters). The note comes back in `lessons_learned` the next time the skill loads, in any conversation.

Skills are per user: `SkillStore.list(userId)` decides which ones a user has. Helpers (subagents) can call `skills_load` but get no index, so the parent should name the skill in the task when it matters.

### Skills or memory?

| Put it in | When |
|---|---|
| USER.md / MEMORY.md (`memory_update`) | It matters in every conversation: who the user is, how they like answers, standing conventions. |
| A skill note (`skills_note`) | It matters only for one kind of task: "for this user's degree map, list electives by semester". |
| A skill | It is a reusable procedure, the same for many users. |

## Writing a skill

A skill body is plain markdown written as instructions to the agent. What works well:

- **A precise description.** It is the only part the agent sees before loading, so say *when* to use it: "Use when the student asks what is left for their degree, graduation planning or which classes to take next."
- **Tool names, exactly.** "Call `canvas_upcoming` with `days=14`, then ..." Models follow named tools far better than vague steps.
- **Honesty rules.** What to do when a step fails (report the blocker, never guess), and what never to do (submit for the user, ask for passwords).
- **An output format.** A table or template for the final answer makes results consistent across models.
- **A short checklist** at the end that the agent can verify before answering.
- **Small.** Most good skills are 40 to 150 lines. Split a skill that covers two different jobs.

Example:

```markdown
# Weekly study plan

Use the student's real deadlines; never invent assignments.

## Steps
1. Call `canvas_upcoming` with `days=7`.
2. Estimate hours per item (reading 1 h per chapter, problem sets 2-3 h, essays 1 h per page).
3. Ask with `ask_user` for unavailable hours if they are not in USER.md.
4. Spread the work so nothing lands on the due date.

## Answer format
| Day | Task | Course | Hours |
|---|---|---|---:|

## Checklist
- [ ] Every item comes from Canvas.
- [ ] No day has more than the student's available hours.
```

## Serving skills from your host

Implement `SkillStore` (contract in [Ports](ports.md#skillstore)). A typical host mixes three sources:

| Source | Where it lives | Notes |
|---|---|---|
| Built-in | Markdown files shipped with the app (`skills/<slug>/SKILL.md` with a frontmatter for name and description) | The same for everyone. Render placeholders such as `{{user.display_name}}` in `load`. |
| Organization | Toggles per organization | Hide skills an organization does not offer, and hide their tools with `toolFilter` too. |
| Personal | The user's own skills in your database | Markdown only; let users edit them. |

Rules for `list` and `load`:

- `list` returns only the skills this user may use right now. The order is the order of the index in the prompt.
- `load` returns `null` for a slug the user does not have, even if it exists for others. The agent then gets "No skill ... is available".
- `notes` are this user's lessons for that slug, newest first, a handful at most (StudyHawk sends the last 20).
- `addNote` may be called with any slug the agent typed; store it scoped to the user and slug.

StudyHawk' `PgSkillStore` and `BuiltinSkills` (backend) are a complete example: built-in skills from files with frontmatter, per-institution switches that also hide the related tools, per-user switches, personal skills and notes.

## Testing

`InMemorySkillStore` takes the skills as an array, which makes skill-driven tests short:

```ts
const skills = new InMemorySkillStore([
  { slug: 'study-plan', name: 'Study plan', description: 'Plan a week of study', body: '# Study plan\n1. Call canvas_upcoming...' },
]);
```

With a scripted provider you can assert that the agent loads the skill (`skills_load` in `result.toolCalls`) and that a note saved in one run appears in `lessons_learned` in the next.
