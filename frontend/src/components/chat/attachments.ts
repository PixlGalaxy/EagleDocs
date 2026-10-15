import { apiUrl } from '../../api/client';
import type { MessageAttachment } from '../../api/types';

/** The backend takes up to this many files per message. */
export const MAX_ATTACHMENTS = 10;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif|avif)$/i;
const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|ya?ml|toml|ini|log|xml|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|java|c|h|cpp|hpp|cs|go|rs|rb|php|sh|ps1|bat|sql|r|m|tex|bib|ipynb)$/i;

export const isImageName = (name: string) => IMAGE_EXT.test(name);
export const isTextName = (name: string) => TEXT_EXT.test(name);
export const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name);

/** A workspace file as the browser can load it; `inline` asks to show it rather than save it. */
export const fileUrl = (path: string, inline = false) => `${apiUrl('/files/download')}?path=${encodeURIComponent(path)}${inline ? '&inline=1' : ''}`;

/**
 * The workspace path behind a link the agent wrote, or null for any other link.
 * It is told to write `workspace:<path>`; models also use their own habits:
 * `/workspace/<path>` (the sandbox mount), `sandbox:/workspace/<path>` and
 * ChatGPT's `sandbox:/mnt/data/<path>`.
 */
export function workspaceLinkPath(href: string): string | null {
  let rest: string;
  if (/^workspace:/i.test(href)) rest = href.slice('workspace:'.length);
  else if (/^sandbox:/i.test(href)) rest = href.slice('sandbox:'.length);
  else if (/^\/workspace\//i.test(href)) rest = href;
  else return null;
  rest = rest.replace(/^\/+/, '').replace(/^(workspace|mnt\/data)\//i, '');
  try {
    rest = decodeURIComponent(rest);
  } catch {
    // Not percent-encoded: keep it as written.
  }
  return rest && !rest.split('/').includes('..') ? rest : null;
}

/** Where the composer stages uploads until the message is sent: one TEMP folder per day. */
export function uploadFolder(now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // In TEMP: sending moves them into the chat's folder (Chats/<id>); a file never sent is deleted after 24 h.
  return `TEMP/uploads/${day}`;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A file in the composer tray: uploading, ready (has its workspace path) or failed. */
export interface DraftAttachment extends Omit<MessageAttachment, 'path'> {
  id: string;
  path: string | null;
  /** 0..1 while uploading. */
  progress: number;
  error: string | null;
  /** Local object URL for an image picked from the device (revoked when removed). */
  preview: string | null;
}
