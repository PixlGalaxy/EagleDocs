import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { ExecRequest, ToolContext } from 'pixlai-engine';
import type { SettingsService } from '../../db/settings.js';
import type { LabService } from '../../modules/lab/lab.service.js';
import { DiskWorkspace } from '../workspace.js';
import { clock, mediaTranscribe, transcriptMarkdown } from './lab.js';

const root = mkdtempSync(join(tmpdir(), 'studyhawk-labtool-'));
after(() => rmSync(root, { recursive: true, force: true }));
const settings = { getNumber: (_k: string, d: number) => d, getString: (_k: string, d: string) => d, getBoolean: (_k: string, d: boolean) => d } as unknown as SettingsService;
const workspace = new DiskWorkspace(root, settings);
const USER = '11111111-2222-4333-8444-555555555555';
mkdirSync(join(root, 'workspaces', USER, 'Lectures'), { recursive: true });
mkdirSync(join(root, 'temp', USER), { recursive: true });

/** A sandbox that "runs" ffprobe and ffmpeg: a duration, then N pieces in the folder it was asked for. */
function sandbox(seconds: number, commands: string[]) {
  return {
    exec: async (_user: string, req: ExecRequest) => {
      commands.push(req.code);
      if (req.code.startsWith('ffprobe')) return { exitCode: 0, stdout: `${seconds}\n`, stderr: '', timedOut: false, durationMs: 5 };
      const dir = /mkdir -p '\.\/([^']+)'/.exec(req.code)![1]!.replace(/^TEMP\//, '');
      mkdirSync(join(root, 'temp', USER, dir), { recursive: true });
      for (let i = 0; i < Math.ceil(seconds / 60); i++) writeFileSync(join(root, 'temp', USER, dir, `part-${String(i).padStart(4, '0')}.wav`), 'x');
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 5 };
    },
  };
}

/** A queue that answers each piece with two timed segments naming the piece. */
function lab(roomAu: number | null) {
  const submitted: { path: string }[] = [];
  const withdrawn: string[] = [];
  const service = {
    room: async () => roomAu,
    ahead: async () => 2,
    submit: async (_u: string, _k: string, input: { path: string }) => (submitted.push(input), `t${submitted.length}`),
    wait: async (id: string) => ({ text: '', language: 'en', segments: [{ start: 2, end: 10, text: `piece ${id}` }, { start: 10, end: 50, text: 'continues.' }] }),
    withdraw: async (ids: string[]) => void withdrawn.push(...ids),
  } as unknown as LabService;
  return { service, submitted, withdrawn };
}

function ctx(sb: ReturnType<typeof sandbox>, service: LabService, notices: string[]): ToolContext {
  return {
    host: { lab: { userId: USER, service, workspace } },
    sandbox: sb,
    signal: new AbortController().signal,
    emit: (e: { type: string; message?: string }) => e.type === 'notice' && notices.push(e.message!),
  } as unknown as ToolContext;
}

test('times read as [mm:ss], with hours when the recording is long', () => {
  assert.equal(clock(75), '01:15');
  assert.equal(clock(3725), '1:02:05');
  assert.match(transcriptMarkdown('a.mp3', [{ text: '', segments: [{ start: 3, end: 9, text: 'hi' }] }], 'es'), /\*\*\[00:03\]\*\* hi/);
});

test('a lecture is cut in minute pieces, queued as batch work and saved as a timed transcript next to it', async () => {
  writeFileSync(join(root, 'workspaces', USER, 'Lectures', "Bob's class.mp4"), 'video');
  const commands: string[] = [];
  const notices: string[] = [];
  const q = lab(10);
  const out = (await mediaTranscribe.run({ path: "Lectures/Bob's class.mp4", language: 'EN' }, ctx(sandbox(150, commands), q.service, notices))) as { transcript: string; duration: string };

  assert.equal(out.transcript, "Lectures/Bob's class.transcript.md");
  assert.equal(out.duration, '02:30');
  // The quote in the name is escaped for the shell.
  assert.ok(commands.every((c) => c.includes(`'./Lectures/Bob'\\''s class.mp4'`)), commands.join('\n'));
  assert.equal(q.submitted.length, 3);
  assert.ok(q.submitted.every((s) => /^TEMP\/lab\/[0-9a-f]{8}\/part-000\d\.wav$/.test(s.path)));
  const md = readFileSync(join(root, 'workspaces', USER, 'Lectures', "Bob's class.transcript.md"), 'utf8');
  assert.match(md, /\*\*\[00:02\]\*\* piece t1 continues\./);
  assert.match(md, /\*\*\[01:02\]\*\* piece t2/);
  assert.match(md, /\*\*\[02:02\]\*\* piece t3/);
  assert.match(md, /language: en/);
  assert.match(notices[0]!, /3 pieces, 2 tasks from others ahead/);
  // The pieces are gone.
  const dir = /TEMP\/lab\/([0-9a-f]{8})/.exec(q.submitted[0]!.path)![1]!;
  assert.equal(existsSync(join(root, 'temp', USER, 'lab', dir)), false);
});

test('a recording the student has no units for is refused before anything is cut', async () => {
  writeFileSync(join(root, 'workspaces', USER, 'Lectures', 'long.mp3'), 'audio');
  const commands: string[] = [];
  const q = lab(1);
  await assert.rejects(mediaTranscribe.run({ path: 'Lectures/long.mp3' }, ctx(sandbox(3600, commands), q.service, [])), /needs about 12 Accelerator Units and the student has 1 left/);
  assert.equal(commands.length, 1, 'only ffprobe ran');
  assert.equal(q.submitted.length, 0);
});

test('files that are not recordings are refused', async () => {
  await assert.rejects(mediaTranscribe.run({ path: 'Lectures/notes.pdf' }, ctx(sandbox(10, []), lab(null).service, [])), /not an audio or video file/);
});
