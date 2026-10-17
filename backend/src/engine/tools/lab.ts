import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { defineTool, type ToolContext } from 'pixlai-engine';
import type { Segment } from '../../modules/lab/backends.js';
import { LabError, type LabKind, type LabService } from '../../modules/lab/lab.service.js';
import type { DiskWorkspace } from '../workspace.js';

/** What the worker puts in `host.lab` for each run. */
export interface LabHost {
  userId: string;
  service: LabService;
  workspace: DiskWorkspace;
}

/** Each piece of audio is one task: a picture asked for in a chat never waits more than a piece. */
export const CHUNK_SECONDS = 60;
/** GPU minutes per minute of audio, to check the student's units before starting (whisper on a small GPU). */
const AU_PER_AUDIO_MINUTE = 0.2;
/** GPU minutes per frame described (a 4B vision model on a small GPU). */
const AU_PER_FRAME = 0.1;
const MAX_HOURS = 4;
const DEFAULT_FRAMES = 60;
const MAX_FRAMES = 150;
const MEDIA = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|webm|mp4|m4v|mov|mkv|avi|mpeg|mpg|3gp)$/i;
const VIDEO = /\.(webm|mp4|m4v|mov|mkv|avi|mpeg|mpg|3gp)$/i;
/** What the vision model answers for a frame with nothing to read or learn from. */
const NO_CONTENT = 'NO_CONTENT';

function labOf(ctx: ToolContext): LabHost {
  const host = ctx.host.lab as LabHost | undefined;
  if (!host) throw new Error('The Accelerator Lab is not available in this run');
  return host;
}

/** A workspace path for the sandbox's shell: single-quoted, and never read as an option ("-x.mp3"). */
const quote = (path: string) => `'./${path.replace(/'/g, `'\\''`)}'`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** ", 3 tasks from others ahead, about 4 min": what the student is told while the work waits. */
async function standing(lab: LabHost): Promise<string> {
  const { ahead, seconds } = await lab.service.eta(lab.userId);
  const parts = [ahead ? `${ahead} tasks from others ahead` : '', seconds ? `about ${seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`}` : ''].filter(Boolean);
  return parts.length ? `, ${parts.join(', ')}` : '';
}

/** 75 -> "01:15", 3725 -> "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A piece's words as one line (its segments, or the whole text when the server gave none). */
const pieceText = (piece: { segments: Segment[]; text: string }) =>
  (piece.segments.length ? piece.segments.map((s) => s.text).join(' ') : piece.text).replace(/\s+/g, ' ').trim();

/**
 * One paragraph per piece, stamped with where it starts in the recording: easy to read, and each
 * RAG chunk keeps a time the student can jump to.
 */
export function transcriptMarkdown(title: string, pieces: { segments: Segment[]; text: string }[], language: string | null): string {
  const lines = [`# Transcript: ${title}`, '', `Transcribed by the Accelerator Lab${language ? ` (language: ${language})` : ''}. Times are [minutes:seconds] into the recording.`, ''];
  pieces.forEach((piece, i) => {
    const text = pieceText(piece);
    if (text) lines.push(`**[${clock(i * CHUNK_SECONDS + (piece.segments[0]?.start ?? 0))}]** ${text}`, '');
  });
  return lines.join('\n');
}

/** The words of a description, for spotting a frame that repeats the one before (the same slide). */
const wordSet = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
export function similar(a: string, b: string): boolean {
  const x = wordSet(a);
  const y = wordSet(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.85;
}

/** Up to `max` items spread evenly over the list, first and last included. */
export function spread<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]!);
}

/** The pts_time of each frame `metadata=print` wrote, in order. */
export function frameTimes(metadata: string): number[] {
  return [...metadata.matchAll(/^frame:\s*\d+\s+pts:\s*\S+\s+pts_time:\s*([\d.]+)/gm)].map((m) => Number(m[1]));
}

/**
 * Minute by minute: what was on screen (each frame with its time) and what was said. Minutes with
 * neither are left out; each section is a natural RAG chunk with its time.
 */
export function digestMarkdown(
  title: string,
  seconds: number,
  frames: { time: number; text: string }[],
  pieces: { segments: Segment[]; text: string }[],
  language: string | null,
): string {
  const lines = [
    `# Video digest: ${title}`,
    '',
    `Made by the Accelerator Lab: what was on screen and what was said, minute by minute (${clock(seconds)} long${language ? `, language: ${language}` : ''}). Times are [minutes:seconds] into the video.`,
    '',
  ];
  for (let minute = 0; minute * 60 < seconds; minute++) {
    const shown = frames.filter((f) => Math.floor(f.time / 60) === minute);
    const said = pieces[minute] ? pieceText(pieces[minute]!) : '';
    if (!shown.length && !said) continue;
    lines.push(`## [${clock(minute * 60)} – ${clock(Math.min(seconds, (minute + 1) * 60))}]`, '');
    for (const f of shown) lines.push(`**On screen [${clock(f.time)}]:**`, '', f.text, '');
    if (said) lines.push(`**Said:** ${said}`, '');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------ shared steps

interface Media {
  lab: LabHost;
  path: string;
  language?: string;
}

async function openMedia(ctx: ToolContext, args: { path: string; language?: string }, pattern: RegExp, what: string): Promise<Media> {
  const lab = labOf(ctx);
  if (!ctx.sandbox) throw new Error('The Accelerator Lab needs the workspace sandbox, which is not running on this server');
  const path = String(args.path ?? '').trim().replace(/^\/+/, '');
  if (!pattern.test(path)) throw new Error(`${path} is not ${what} this tool can read`);
  const file = await lab.workspace.stat(lab.userId, path);
  if (!file || file.type !== 'file') throw new Error(`${path} does not exist`);
  const language = /^[a-z]{2,3}$/i.test(args.language ?? '') ? args.language!.toLowerCase() : undefined;
  return { lab, path, ...(language && { language }) };
}

async function shell(ctx: ToolContext, lab: LabHost, code: string, timeoutMs: number) {
  return ctx.sandbox!.exec(lab.userId, { language: 'shell', cwd: '', timeoutMs, code }, ctx.signal);
}

/** Refuses work the student's units cannot pay for, before anything is cut or queued. */
async function checkUnits(lab: LabHost, estimate: number, what: string): Promise<void> {
  const room = await lab.service.room(lab.userId);
  if (room !== null && estimate > room) {
    throw new LabError(`${what} needs about ${round2(estimate)} Accelerator Units and the student has ${round2(room)} left right now. Tell them, and suggest a shorter part or waiting for their units to come back.`);
  }
}

/** Pieces of 60 s, mono 16 kHz (what whisper wants), in `dir`. */
async function cutAudio(ctx: ToolContext, media: Media, dir: string): Promise<string[]> {
  const cut = await shell(
    ctx,
    media.lab,
    `mkdir -p ${quote(dir)} && ffmpeg -v error -nostdin -i ${quote(media.path)} -vn -ac 1 -ar 16000 -f segment -segment_time ${CHUNK_SECONDS} -c:a pcm_s16le ${quote(`${dir}/part-%04d.wav`)}`,
    30 * 60_000,
  );
  if (cut.exitCode !== 0) throw new Error(`Could not cut ${media.path}: ${cut.stderr.trim().slice(0, 300)}`);
  return (await media.lab.workspace.list(media.lab.userId, dir))
    .filter((f) => f.type === 'file' && /part-\d+\.wav$/.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `${dir}/${f.name}`);
}

/** Queues every task as batch work; if one is refused, the ones queued before it are withdrawn. */
async function queueAll(lab: LabHost, tasks: { kind: LabKind; input: Record<string, unknown> }[]): Promise<string[]> {
  const ids: string[] = [];
  try {
    for (const t of tasks) ids.push(await lab.service.submit(lab.userId, t.kind as 'text', t.input as { prompt: string }, 1));
  } catch (err) {
    await lab.service.withdraw(ids);
    throw err;
  }
  return ids;
}

/** Waits for every task in order, telling the chat how far it got about five times. */
async function waitAll<T>(ctx: ToolContext, lab: LabHost, ids: string[], progress: (done: number) => string): Promise<T[]> {
  const out: T[] = [];
  try {
    for (const [i, id] of ids.entries()) {
      out.push((await lab.service.wait(id, ctx.signal)) as T);
      const done = i + 1;
      if (done < ids.length && done % Math.max(1, Math.ceil(ids.length / 5)) === 0) ctx.emit({ type: 'notice', message: progress(done) });
    }
  } catch (err) {
    await lab.service.withdraw(ids);
    throw err;
  }
  return out;
}

const besideSource = (path: string, suffix: string) => {
  const dir = posix.dirname(path);
  return `${dir === '.' ? '' : `${dir}/`}${posix.basename(path).replace(/\.[^.]+$/, '')}${suffix}`;
};

type Piece = { text: string; segments: Segment[]; language: string | null };

// ------------------------------------------------------------------ tools

export const mediaTranscribe = defineTool<{ path: string; language?: string }>({
  name: 'media_transcribe',
  summary: 'transcribe a recording or video in the workspace (lecture, voice note, meeting) on the GPU',
  description:
    "Turns speech in an audio or video file from the workspace (mp3, m4a, wav, mp4, mov, webm...) into a Markdown transcript with " +
    "[mm:ss] times, saved next to the file as <name>.transcript.md. It runs on the server's GPU through a shared queue and " +
    "counts against the student's Accelerator Units (about 0.2 AU per minute of audio): a long lecture can take minutes. " +
    'For a video where the screen matters (slides, board, code), use video_digest instead. Afterwards, index the transcript ' +
    'with rag_add to answer questions about it, or read it with files_read. Download online videos into the workspace first ' +
    '(web_download, or code_run for sites that need it).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path of the recording' },
      language: { type: 'string', description: 'ISO code if known (e.g. "en", "es"); detected when absent' },
    },
    required: ['path'],
  },
  sideEffect: 'none',
  untrusted: true,
  timeoutMs: 6 * 3_600_000,
  async run(args, ctx) {
    const media = await openMedia(ctx, args, MEDIA, 'an audio or video file');
    const { lab, path } = media;

    // How long it is, to check the units before cutting anything.
    const probe = await shell(ctx, lab, `ffprobe -v error -show_entries format=duration -of csv=p=0 ${quote(path)}`, 60_000);
    const seconds = Number(probe.stdout.trim());
    if (probe.exitCode !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read ${path} as audio: ${probe.stderr.trim().slice(0, 300) || 'no duration'}`);
    if (seconds > MAX_HOURS * 3600) throw new Error(`${path} is ${clock(seconds)} long; the Lab takes recordings up to ${MAX_HOURS} hours (cut it first).`);
    const estimate = (seconds / 60) * AU_PER_AUDIO_MINUTE;
    await checkUnits(lab, estimate, `Transcribing ${clock(seconds)} of audio`);

    // In TEMP, so the pieces expire even if this run dies.
    const dir = `TEMP/lab/${randomUUID().slice(0, 8)}`;
    try {
      const parts = await cutAudio(ctx, media, dir);
      if (!parts.length) throw new Error(`${path} has no audio track`);
      const ids = await queueAll(lab, parts.map((p) => ({ kind: 'transcribe', input: { path: p, ...(media.language && { language: media.language }) } })));
      ctx.emit({ type: 'notice', message: `Transcribing ${clock(seconds)} on the Accelerator Lab (${parts.length} pieces${await standing(lab)}).` });
      const pieces = await waitAll<Piece>(ctx, lab, ids, (done) => `Transcribed ${clock(done * CHUNK_SECONDS)} of ${clock(seconds)}.`);

      const out = besideSource(path, '.transcript.md');
      const markdown = transcriptMarkdown(posix.basename(path), pieces, media.language ?? pieces.find((p) => p.language)?.language ?? null);
      await lab.workspace.write(lab.userId, out, markdown);
      return {
        transcript: out,
        duration: clock(seconds),
        words: markdown.split(/\s+/).length,
        accelerator_units_estimate: round2(estimate),
        preview: markdown.slice(0, 1500),
        next: 'Index it with rag_add to answer questions about it, or read it with files_read.',
      };
    } finally {
      await lab.workspace.delete(lab.userId, dir).catch(() => undefined);
    }
  },
});

/** Reads one frame: the text on screen exactly, the figures briefly, nothing about the room. */
const framePrompt = (time: number) =>
  `This is a frame at [${clock(time)}] of a recorded class or video. Copy every piece of text on screen exactly as written ` +
  '(slides, whiteboard, handwriting, code, terminal; math in LaTeX, tables in Markdown). Then describe any diagram, chart, ' +
  'figure or demo in one or two sentences. Do not describe the presenter, the room or the camera. If there is nothing to read ' +
  `or learn from (only a person, a camera view, a blank or loading screen), answer exactly ${NO_CONTENT}. Plain text, no preamble.`;

export const videoDigest = defineTool<{ path: string; language?: string; max_frames?: number }>({
  name: 'video_digest',
  summary: 'turn a video (lecture, tutorial, recorded class) into minute-by-minute notes of what was shown and said, on the GPU',
  description:
    'For a video in the workspace where the screen matters (a lecture with slides, a whiteboard class, a coding tutorial): finds ' +
    'the moments the picture changes (a new slide, the board filling up; at most one every 10 s, at least one every 5 minutes), reads each one with the ' +
    "vision model (text copied exactly, figures described), transcribes the speech, and saves both minute by minute as " +
    "<name>.digest.md next to the video. It runs on the server's GPU through a shared queue and counts against the student's " +
    'Accelerator Units (about 0.2 AU per minute of audio plus 0.1 per frame read); an hour-long lecture can take a while, so tell ' +
    'the student. Afterwards, index the digest with rag_add to answer from it and cite the [mm:ss] times. For audio only, or ' +
    'when only the words matter, use media_transcribe.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path of the video' },
      language: { type: 'string', description: 'ISO code of the speech if known (e.g. "en", "es"); detected when absent' },
      max_frames: { type: 'integer', description: `Most frames to read (default ${DEFAULT_FRAMES}, up to ${MAX_FRAMES}); spread over the video when there are more` },
    },
    required: ['path'],
  },
  sideEffect: 'none',
  untrusted: true,
  timeoutMs: 6 * 3_600_000,
  async run(args, ctx) {
    const media = await openMedia(ctx, args, VIDEO, 'a video file');
    const { lab, path } = media;
    const maxFrames = Math.min(MAX_FRAMES, Math.max(1, Math.round(Number(args.max_frames) || DEFAULT_FRAMES)));

    const probe = await shell(ctx, lab, `ffprobe -v error -show_entries format=duration:stream=codec_type -of json ${quote(path)}`, 60_000);
    let info: { format?: { duration?: string }; streams?: { codec_type?: string }[] } = {};
    try {
      info = JSON.parse(probe.stdout) as typeof info;
    } catch {
      /* reported below */
    }
    const seconds = Number(info.format?.duration);
    const kinds = new Set((info.streams ?? []).map((s) => s.codec_type));
    if (probe.exitCode !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read ${path} as a video: ${probe.stderr.trim().slice(0, 300) || 'no duration'}`);
    if (!kinds.has('video')) throw new Error(`${path} has no picture; use media_transcribe for audio`);
    if (seconds > MAX_HOURS * 3600) throw new Error(`${path} is ${clock(seconds)} long; the Lab takes videos up to ${MAX_HOURS} hours (cut it first).`);
    // Without a speech server the video is read from its frames alone.
    const hasAudio = kinds.has('audio') && lab.service.available('transcribe');
    const audioAu = hasAudio ? (seconds / 60) * AU_PER_AUDIO_MINUTE : 0;
    await checkUnits(lab, audioAu, `Reading ${clock(seconds)} of video`);

    const dir = `TEMP/lab/${randomUUID().slice(0, 8)}`;
    try {
      // The frames worth reading: the first, each change of picture at least 10 s after the last one kept, and one every
      // 5 minutes even without a change. A new slide on the same template moves the scene score only 0.03-0.10, so the
      // threshold is low; the frame cap, NO_CONTENT and the repeat check keep camera noise out. Only keyframes are
      // decoded, so an hour of video takes seconds, not minutes.
      const select = "isnan(prev_selected_t)+gte(t-prev_selected_t\\,300)+gt(scene\\,0.02)*gte(t-prev_selected_t\\,10)";
      const grab = await shell(
        ctx,
        lab,
        `mkdir -p ${quote(`${dir}/frames`)} && ffmpeg -v error -nostdin -skip_frame nokey -i ${quote(path)} -an ` +
          `-vf "select='${select}',metadata=print:file=./${dir}/frames.txt,scale='min(1024\\,iw)':-2" ` +
          `-fps_mode vfr -q:v 3 ${quote(`${dir}/frames/f-%05d.jpg`)}`,
        30 * 60_000,
      );
      if (grab.exitCode !== 0) throw new Error(`Could not read the frames of ${path}: ${grab.stderr.trim().slice(0, 300)}`);
      const times = frameTimes((await lab.workspace.read(lab.userId, `${dir}/frames.txt`).catch(() => Buffer.from(''))).toString('utf8'));
      const files = (await lab.workspace.list(lab.userId, `${dir}/frames`)).filter((f) => f.type === 'file' && /^f-\d+\.jpg$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      const frames = spread(
        files.map((f, i) => ({ path: `${dir}/frames/${f.name}`, time: times[i] ?? 0 })),
        maxFrames,
      );
      await checkUnits(lab, audioAu + frames.length * AU_PER_FRAME, `Reading ${clock(seconds)} of video (${frames.length} frames)`);

      const parts = hasAudio ? await cutAudio(ctx, media, `${dir}/audio`) : [];
      // Frames and speech in one go: the queue interleaves them with everyone else's work.
      const ids = await queueAll(lab, [
        ...frames.map((f) => ({ kind: 'vision' as const, input: { path: f.path, prompt: framePrompt(f.time) } })),
        ...parts.map((p) => ({ kind: 'transcribe' as const, input: { path: p, ...(media.language && { language: media.language }) } })),
      ]);
      ctx.emit({
        type: 'notice',
        message: `Reading ${clock(seconds)} of video on the Accelerator Lab: ${frames.length} frames${parts.length ? ` and ${parts.length} minutes of speech` : ''}${await standing(lab)}.`,
      });
      const results = await waitAll<{ text: string } | Piece>(ctx, lab, ids, (done) => `Video: ${done} of ${ids.length} pieces read.`);

      // Frames with nothing on them, and the same slide seen again, are left out.
      const described: { time: number; text: string }[] = [];
      let skipped = 0;
      frames.forEach((f, i) => {
        const text = (results[i] as { text: string }).text.trim();
        const last = described.at(-1);
        if (!text || text.includes(NO_CONTENT) || (last && similar(last.text, text))) skipped++;
        else described.push({ time: f.time, text });
      });
      const pieces = results.slice(frames.length) as Piece[];

      const out = besideSource(path, '.digest.md');
      const markdown = digestMarkdown(posix.basename(path), seconds, described, pieces, media.language ?? pieces.find((p) => p.language)?.language ?? null);
      await lab.workspace.write(lab.userId, out, markdown);
      return {
        digest: out,
        duration: clock(seconds),
        frames_read: described.length,
        ...(kinds.has('audio') && !hasAudio && { speech: 'not transcribed: this server has no speech-to-text in its Accelerator Lab' }),
        frames_left_out: skipped,
        speech_minutes: parts.length,
        accelerator_units_estimate: round2(audioAu + frames.length * AU_PER_FRAME),
        preview: markdown.slice(0, 1500),
        next: 'Index it with rag_add to answer from it and cite the [mm:ss] times, or read it with files_read.',
      };
    } finally {
      await lab.workspace.delete(lab.userId, dir).catch(() => undefined);
    }
  },
});

export const LAB_TOOLS = [mediaTranscribe, videoDigest];
