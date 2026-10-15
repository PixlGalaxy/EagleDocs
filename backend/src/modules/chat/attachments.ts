import type { ChatImage, ChatMessage } from 'pixlai-engine';
import type { DiskWorkspace } from '../../engine/workspace.js';
import { badRequest } from '../../errors.js';

/** A workspace file the student attached to a message. */
export interface Attachment {
  path: string;
  name: string;
  kind: 'image' | 'file';
  size: number;
}

export const MAX_ATTACHMENTS = 10;
/** Pictures models read directly. SVG is not one: it is code, and it never renders inline here. */
export const IMAGE_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
/** Larger pictures are listed as files instead of sent to the model. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/** Images are sent with the newest messages that have them; older ones become a note (they would fill the context). */
const IMAGE_MESSAGES = 2;

const extOf = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';

/** Checks every path is a file in the student's workspace and describes it. */
export async function resolveAttachments(workspace: DiskWorkspace, userId: string, value: unknown): Promise<Attachment[]> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) throw badRequest('chat.badAttachments');
  const out: Attachment[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 500) throw badRequest('chat.badAttachments');
    const stat = await workspace.stat(userId, raw.trim()).catch(() => null);
    if (!stat || stat.type !== 'file') throw badRequest('chat.badAttachments');
    const image = Boolean(IMAGE_TYPES[extOf(stat.path)]) && stat.size <= MAX_IMAGE_BYTES;
    if (!out.some((a) => a.path === stat.path)) out.push({ path: stat.path, name: stat.name, kind: image ? 'image' : 'file', size: stat.size });
  }
  return out;
}

/** Where the composer uploads before a message is sent ("Chat uploads/<day>/..."). */
export const UPLOADS_FOLDER = 'Chat uploads';

/**
 * Files the composer uploaded for this message move into the chat's folder
 * (a name already there gets " (2)", " (3)"...). Files the student picked from
 * elsewhere in the workspace stay where they are.
 */
export async function intoChatFolder(workspace: DiskWorkspace, userId: string, attachments: Attachment[], folder: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const a of attachments) {
    if (!a.path.startsWith(`${UPLOADS_FOLDER}/`)) {
      out.push(a);
      continue;
    }
    const dot = a.name.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [a.name.slice(0, dot), a.name.slice(dot)] : [a.name, ''];
    let target = `${folder}/${a.name}`;
    for (let n = 2; await workspace.stat(userId, target).catch(() => null); n++) target = `${folder}/${stem} (${n})${ext}`;
    await workspace.move(userId, a.path, target);
    out.push({ ...a, path: target, name: target.slice(folder.length + 1) });
  }
  return out;
}

/**
 * Turns attachments into what the model gets: every file listed in the
 * message (so tools can open it), and the pictures of the newest messages as
 * images. Unreadable files are listed with a note rather than failing the run.
 */
export async function withAttachments(
  workspace: DiskWorkspace,
  userId: string,
  history: (ChatMessage & { attachments?: Attachment[] })[],
): Promise<ChatMessage[]> {
  let imageMessages = 0;
  const out: ChatMessage[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const { attachments, ...message } = history[i]!;
    if (!attachments?.length) {
      out.unshift(message);
      continue;
    }
    const list = attachments.map((a) => `- ${a.path} (${a.kind}, ${Math.max(1, Math.round(a.size / 1024))} KB)`).join('\n');
    const content = [message.content, `[Files the user attached, in their workspace:\n${list}]`].filter(Boolean).join('\n\n');
    const images: ChatImage[] = [];
    if (imageMessages < IMAGE_MESSAGES && attachments.some((a) => a.kind === 'image')) {
      imageMessages++;
      for (const a of attachments.filter((x) => x.kind === 'image')) {
        const data = await workspace.read(userId, a.path).catch(() => null);
        if (data) images.push({ mediaType: IMAGE_TYPES[extOf(a.path)]!, data: data.toString('base64'), name: a.path });
      }
    }
    out.unshift({ ...message, content, ...(images.length && { images }) });
  }
  return out;
}
