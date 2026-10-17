import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { defineTool, type ToolContext } from 'pixlai-engine';
import type { Segment } from '../../modules/lab/backends.js';
import { LabError, type LabService } from '../../modules/lab/lab.service.js';
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
const MAX_HOURS = 4;
const MEDIA = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|wma|webm|mp4|m4v|mov|mkv|avi|mpeg|mpg|3gp)$/i;

function labOf(ctx: ToolContext): LabHost {
  const host = ctx.host.lab as LabHost | undefined;
  if (!host) throw new Error('The Accelerator Lab is not available in this run');
  return host;
}

/** A workspace path for the sandbox's shell: single-quoted, and never read as an option ("-x.mp3"). */
const quote = (path: string) => `'./${path.replace(/'/g, `'\\''`)}'`;

/** 75 -> "01:15", 3725 -> "1:02:05". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * One paragraph per piece, stamped with where it starts in the recording: easy to read, and each
 * RAG chunk keeps a time the student can jump to.
 */
export function transcriptMarkdown(title: string, pieces: { segments: Segment[]; text: string }[], language: string | null): string {
  const lines = [`# Transcript: ${title}`, '', `Transcribed by the Accelerator Lab${language ? ` (language: ${language})` : ''}. Times are [minutes:seconds] into the recording.`, ''];
  pieces.forEach((piece, i) => {
    const text = (piece.segments.length ? piece.segments.map((s) => s.text).join(' ') : piece.text).replace(/\s+/g, ' ').trim();
    if (text) lines.push(`**[${clock(i * CHUNK_SECONDS + (piece.segments[0]?.start ?? 0))}]** ${text}`, '');
  });
  return lines.join('\n');
}

export const mediaTranscribe = defineTool<{ path: string; language?: string }>({
  name: 'media_transcribe',
  summary: 'transcribe a recording or video in the workspace (lecture, voice note, meeting) on the GPU',
  description:
    "Turns speech in an audio or video file from the workspace (mp3, m4a, wav, mp4, mov, webm...) into a Markdown transcript with " +
    "[mm:ss] times, saved next to the file as <name>.transcript.md. It runs on the server's GPU through a shared queue and " +
    "counts against the student's Accelerator Units (about 0.2 AU per minute of audio): a long lecture can take minutes. " +
    'Afterwards, index the transcript with rag_add to answer questions about it, or read it with files_read. Download online ' +
    'videos into the workspace first (web_download, or code_run for sites that need it).',
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
    const lab = labOf(ctx);
    if (!ctx.sandbox) throw new Error('Transcription needs the workspace sandbox, which is not running on this server');
    const path = String(args.path ?? '').trim().replace(/^\/+/, '');
    if (!MEDIA.test(path)) throw new Error(`${path} is not an audio or video file this tool can read`);
    const file = await lab.workspace.stat(lab.userId, path);
    if (!file || file.type !== 'file') throw new Error(`${path} does not exist`);
    const language = /^[a-z]{2,3}$/i.test(args.language ?? '') ? args.language!.toLowerCase() : undefined;

    // How long it is, to check the units before cutting anything.
    const probe = await ctx.sandbox.exec(
      lab.userId,
      { language: 'shell', cwd: '', timeoutMs: 60_000, code: `ffprobe -v error -show_entries format=duration -of csv=p=0 ${quote(path)}` },
      ctx.signal,
    );
    const seconds = Number(probe.stdout.trim());
    if (probe.exitCode !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read ${path} as audio: ${probe.stderr.trim().slice(0, 300) || 'no duration'}`);
    if (seconds > MAX_HOURS * 3600) throw new Error(`${path} is ${clock(seconds)} long; the Lab takes recordings up to ${MAX_HOURS} hours (cut it first).`);
    const estimate = Math.round((seconds / 60) * AU_PER_AUDIO_MINUTE * 100) / 100;
    const room = await lab.service.room(lab.userId);
    if (room !== null && estimate > room) {
      throw new LabError(`Transcribing ${clock(seconds)} of audio needs about ${estimate} Accelerator Units and the student has ${Math.round(room * 100) / 100} left right now. Tell them, and suggest a shorter part or waiting for their units to come back.`);
    }

    // Pieces of 60 s, mono 16 kHz (what whisper wants), in TEMP so they expire even if this run dies.
    const dir = `TEMP/lab/${randomUUID().slice(0, 8)}`;
    const cut = await ctx.sandbox.exec(
      lab.userId,
      {
        language: 'shell',
        cwd: '',
        timeoutMs: 30 * 60_000,
        code: `mkdir -p ${quote(dir)} && ffmpeg -v error -nostdin -i ${quote(path)} -vn -ac 1 -ar 16000 -f segment -segment_time ${CHUNK_SECONDS} -c:a pcm_s16le ${quote(`${dir}/part-%04d.wav`)}`,
      },
      ctx.signal,
    );
    try {
      if (cut.exitCode !== 0) throw new Error(`Could not cut ${path}: ${cut.stderr.trim().slice(0, 300)}`);
      const parts = (await lab.workspace.list(lab.userId, dir)).filter((f) => f.type === 'file' && /part-\d+\.wav$/.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
      if (!parts.length) throw new Error(`${path} has no audio track`);

      const ids: string[] = [];
      try {
        for (const part of parts) ids.push(await lab.service.submit(lab.userId, 'transcribe', { path: `${dir}/${part.name}`, ...(language && { language }) }, 1));
      } catch (err) {
        await lab.service.withdraw(ids);
        throw err;
      }
      const ahead = await lab.service.ahead(lab.userId);
      ctx.emit({ type: 'notice', message: `Transcribing ${clock(seconds)} on the Accelerator Lab (${parts.length} pieces${ahead ? `, ${ahead} tasks from others ahead` : ''}).` });

      const pieces = [];
      let detected: string | null = null;
      try {
        for (const [i, id] of ids.entries()) {
          const out = await lab.service.wait<'transcribe'>(id, ctx.signal);
          pieces.push(out);
          detected ??= out.language;
          const done = i + 1;
          if (done < ids.length && done % Math.max(1, Math.ceil(ids.length / 5)) === 0) ctx.emit({ type: 'notice', message: `Transcribed ${clock(done * CHUNK_SECONDS)} of ${clock(seconds)}.` });
        }
      } catch (err) {
        await lab.service.withdraw(ids);
        throw err;
      }

      const name = posix.basename(path);
      const out = `${posix.dirname(path) === '.' ? '' : `${posix.dirname(path)}/`}${name.replace(/\.[^.]+$/, '')}.transcript.md`;
      const markdown = transcriptMarkdown(name, pieces, language ?? detected);
      await lab.workspace.write(lab.userId, out, markdown);
      const words = markdown.split(/\s+/).length;
      return {
        transcript: out,
        duration: clock(seconds),
        words,
        accelerator_units_estimate: estimate,
        preview: markdown.slice(0, 1500),
        next: 'Index it with rag_add to answer questions about it, or read it with files_read.',
      };
    } finally {
      await lab.workspace.delete(lab.userId, dir).catch(() => undefined);
    }
  },
});

export const LAB_TOOLS = [mediaTranscribe];
