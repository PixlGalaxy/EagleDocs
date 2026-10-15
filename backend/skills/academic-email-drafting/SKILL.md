---
name: Academic Email Drafting
description: Use when the student wants to write, revise or send an email to a professor, advisor, classmate or office. Covers the draft, approval, send and verification flow.
requires: outlook
---
# Academic Email Drafting and Sending

Use when {{user.display_name}} asks you to write, answer or send an email from their {{institution.name}} account. For reading or triaging the inbox use `academic-email`.

## Core rules
1. Draft first. Show the full draft and wait for the student's explicit approval before sending. `email_send` always waits for approval in the UI, but you must still present the draft in chat and not rush the request.
2. Never send automatically just because the topic seems routine. The only exception is when the student already approved the exact recipient, subject and body in this same conversation.
3. Do not fabricate facts about the student (illnesses, family reasons, past conversations, grades, dates). Use only what the student told you or what you read in Canvas/email. Ask with `ask_user` when a detail is missing.
4. Do not ask for passwords or Duo codes. If a sign-in is needed, a Duo prompt appears automatically; tell the student to approve it on their phone.
5. Report honestly what was done: "draft saved", "sent", or "send was not approved / failed". Do not claim success without confirmation.

## Workflow
1. Identify the recipient, purpose and any deadline. If the address is unknown, look in earlier mail (`email_search`), the Canvas course (`canvas_course`) or ask the student. Never guess an address.
2. If replying, read the original with `email_read` first so the answer matches the thread.
3. Write a concise draft:
   - Clear subject that includes the course and the purpose.
   - Greeting with the correct title (Professor / Dr. + last name) when known.
   - Say who the student is (name, course, section if known) in the first line, then the request.
   - One request per paragraph; give dates and specifics; say what was already tried.
   - Polite close and the student's name.
   - Keep it short: most academic emails fit in 80-150 words.
4. Save it with `email_draft` (to, subject, body) and show it:
```markdown
To: <recipient>
Subject: <subject>

<body>
```
5. Ask: send as is, or change something? Apply edits, save again and show the new version.
6. After approval call `email_send`. The UI asks the student to confirm; if Duo/MFA appears, tell the student to approve on their phone.
7. Verify: check the result of `email_send` and, when possible, look for the message with `email_search`. If verification is inconclusive, say so plainly and do NOT retry blindly (it could send a duplicate).

## Tone guide
- Respectful, direct, no filler. Avoid demanding language ("I need you to").
- Late work, extension or grade questions: state the situation briefly and honestly, propose a concrete solution, thank them.
- Never write in a way that misleads the recipient about what happened.
- If the student speaks another language, draft in the recipient's language (usually English) and offer a short translation so the student understands exactly what will be sent.

## Checklist
- [ ] Recipient known, not guessed.
- [ ] Draft shown in full and approved.
- [ ] No invented personal facts.
- [ ] MFA handled by the student on their phone.
- [ ] Sent state verified, or the blocker reported.
