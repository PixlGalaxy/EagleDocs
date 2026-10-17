import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import type { ExecRequest, ToolContext } from 'pixlai-engine';
import type { SettingsService } from '../../db/settings.js';
import type { LabService } from '../../modules/lab/lab.service.js';
import { DiskWorkspace } from '../workspace.js';
import { digestMarkdown, frameTimes, similar, spread, videoDigest } from './lab.js';

const root = mkdtempSync(join(tmpdir(), 'studyhawk-labvideo-'));
after(() => rmSync(root, { recursive: true, force: true }));
const settings = { getNumber: (_k: string, d: number) => d, getString: (_k: string, d: string) => d, getBoolean: (_k: string, d: boolean) => d } as unknown as SettingsService;
const workspace = new DiskWorkspace(root, settings);
const USER = '11111111-2222-4333-8444-555555555556';
mkdirSync(join(root, 'workspaces', USER, 'Lectures'), { recursive: true });
mkdirSync(join(root, 'temp', USER), { recursive: true });

/** A sandbox for video_digest: ffprobe JSON, frames with their metadata, and audio pieces. */
function videoSandbox(seconds: number, frameAt: number[], withAudio: boolean, commands: string[] = []) {
  return {
    exec: async (_user: string, req: ExecRequest) => {
      commands.push(req.code);
      if (req.code.startsWith('ffprobe')) {
        const streams = [{ codec_type: 'video' }, ...(withAudio ? [{ codec_type: 'audio' }] : [])];
        return { exitCode: 0, stdout: JSON.stringify({ format: { duration: String(seconds) }, streams }), stderr: '', timedOut: false, durationMs: 5 };
      }
      const dir = /mkdir -p '\.\/([^']+)'/.exec(req.code)![1]!.replace(/^TEMP\//, '');
      const abs = join(root, 'temp', USER, dir);
      mkdirSync(abs, { recursive: true });
      if (dir.endsWith('/frames')) {
        frameAt.forEach((_, i) => writeFileSync(join(abs, `f-${String(i + 1).padStart(5, '0')}.jpg`), 'jpg'));
        writeFileSync(join(abs, '..', 'frames.txt'), frameAt.map((t, i) => `frame:${i}    pts:${t * 12800}  pts_time:${t}\nlavfi.scene_score=0.5`).join('\n'));
      } else {
        for (let i = 0; i < Math.ceil(seconds / 60); i++) writeFileSync(join(abs, `part-${String(i).padStart(4, '0')}.wav`), 'x');
      }
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false, durationMs: 5 };
    },
  };
}

/** A queue whose vision model reads the n-th frame as `answers[n]` and hears "minute N". */
function videoLab(answers: string[], roomAu: number | null = null) {
  const tasks: { kind: string; input: Record<string, unknown> }[] = [];
  const service = {
    room: async () => roomAu,
    available: () => true,
    ahead: async () => 0,
    withdraw: async () => undefined,
    submit: async (_u: string, kind: string, input: Record<string, unknown>) => (tasks.push({ kind, input }), `t${tasks.length}`),
    wait: async (id: string) => {
      const i = Number(id.slice(1)) - 1;
      const sameKind = tasks.slice(0, i + 1).filter((t) => t.kind === tasks[i]!.kind).length;
      if (tasks[i]!.kind === 'vision') return { text: answers[sameKind - 1] };
      return { text: '', language: 'en', segments: [{ start: 0, end: 50, text: `minute ${sameKind}` }] };
    },
  } as unknown as LabService;
  return { service, tasks };
}

const ctx = (sandbox: ReturnType<typeof videoSandbox>, service: LabService) =>
  ({ host: { lab: { userId: USER, service, workspace } }, sandbox, signal: new AbortController().signal, emit: () => undefined }) as unknown as ToolContext;

test('frame helpers: times from ffmpeg metadata, evenly spread frames, the same slide spotted again', () => {
  assert.deepEqual(frameTimes('frame:0    pts:0       pts_time:0\nlavfi.scene_score=0\nframe:1    pts:768000  pts_time:60.5\n'), [0, 60.5]);
  assert.deepEqual(spread([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4), [1, 4, 7, 10]);
  assert.deepEqual(spread([1, 2], 5), [1, 2]);
  assert.equal(similar('Chapter 3: Supply and demand curves', 'Chapter 3 - supply and demand curves'), true);
  assert.equal(similar('Chapter 3: Supply and demand', 'Chapter 4: Elasticity of demand'), false);
});

test('the digest groups what was shown and said by minute and leaves out empty minutes', () => {
  const md = digestMarkdown('class.mp4', 185, [{ time: 12, text: 'Slide 1' }, { time: 130, text: 'Slide 2' }], [{ text: 'hi', segments: [] }], 'es');
  assert.match(md, /## \[00:00 – 01:00\]\n\n\*\*On screen \[00:12\]:\*\*\n\nSlide 1\n\n\*\*Said:\*\* hi/);
  assert.doesNotMatch(md, /\[01:00 – 02:00\]/);
  assert.match(md, /## \[02:00 – 03:00\]\n\n\*\*On screen \[02:10\]:\*\*/);
});

test('a lecture video becomes minute notes of the slides and the speech, without empty or repeated frames', async () => {
  writeFileSync(join(root, 'workspaces', USER, 'Lectures', 'econ.mp4'), 'video');
  const commands: string[] = [];
  const q = videoLab(['Supply and demand: definitions', 'NO_CONTENT', 'Supply and demand - definitions', 'Graph of equilibrium price']);
  const out = (await videoDigest.run({ path: 'Lectures/econ.mp4' }, ctx(videoSandbox(150, [0, 40, 70, 125], true, commands), q.service))) as Record<string, unknown>;

  assert.equal(out.digest, 'Lectures/econ.digest.md');
  assert.equal(out.frames_read, 2);
  assert.equal(out.frames_left_out, 2);
  assert.equal(out.speech_minutes, 3);
  const vision = q.tasks.filter((t) => t.kind === 'vision');
  assert.equal(vision.length, 4);
  assert.match(String(vision[1]!.input.prompt), /\[00:40\]/);
  assert.match(String(vision[0]!.input.path), /^TEMP\/lab\/[0-9a-f]{8}\/frames\/f-00001\.jpg$/);
  // Only keyframes are decoded, with the low scene threshold slides need.
  assert.ok(commands.some((c) => c.includes('-skip_frame nokey') && c.includes('gt(scene\\,0.02)')), commands.join('\n'));

  const md = readFileSync(join(root, 'workspaces', USER, 'Lectures', 'econ.digest.md'), 'utf8');
  assert.match(md, /On screen \[00:00\]:\*\*\n\nSupply and demand: definitions/);
  assert.doesNotMatch(md, /NO_CONTENT|Supply and demand - definitions/);
  assert.match(md, /On screen \[02:05\]:\*\*\n\nGraph of equilibrium price/);
  assert.match(md, /\*\*Said:\*\* minute 1/);
});

test('a silent video is read from its frames only, and audio files go to media_transcribe', async () => {
  writeFileSync(join(root, 'workspaces', USER, 'Lectures', 'silent.mov'), 'video');
  const q = videoLab(['Whiteboard: F = ma']);
  const out = (await videoDigest.run({ path: 'Lectures/silent.mov' }, ctx(videoSandbox(30, [0], false), q.service))) as Record<string, unknown>;
  assert.equal(out.speech_minutes, 0);
  assert.equal(q.tasks.filter((t) => t.kind === 'transcribe').length, 0);
  await assert.rejects(videoDigest.run({ path: 'Lectures/talk.mp3' }, ctx(videoSandbox(10, [], true), q.service)), /not a video file/);
});

test('frames past the cap are spread over the video, and the units are checked with them counted', async () => {
  writeFileSync(join(root, 'workspaces', USER, 'Lectures', 'busy.mp4'), 'video');
  const times = Array.from({ length: 40 }, (_, i) => i * 15);
  const q = videoLab(times.map((t) => `slide at ${t} with its own words number ${t}`));
  await videoDigest.run({ path: 'Lectures/busy.mp4', max_frames: 5 }, ctx(videoSandbox(600, times, true), q.service));
  const vision = q.tasks.filter((t) => t.kind === 'vision');
  assert.equal(vision.length, 5);
  assert.match(String(vision[4]!.input.prompt), /\[09:45\]/);

  // 10 minutes of speech (2 AU) fit in 2.5 AU, but not with 10 frames on top (1 AU more): nothing is queued.
  const tight = videoLab([], 2.5);
  await assert.rejects(
    videoDigest.run({ path: 'Lectures/busy.mp4', max_frames: 10 }, ctx(videoSandbox(600, times, true), tight.service)),
    /10 frames\) needs about 3 Accelerator Units/,
  );
  assert.equal(tight.tasks.length, 0);
});
