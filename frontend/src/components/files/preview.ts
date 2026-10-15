import { useEffect, useRef, useState } from 'react';
import { fileUrl, isImageName, isMarkdownName, isTextName } from '../chat/attachments';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'markdown' | 'html' | 'text' | 'spreadsheet' | 'document' | 'none';

// Legacy .doc and PowerPoint have no solid pure-JS renderer yet, so they stay download-only.
const SPREADSHEET_EXT = /\.(xlsx|xlsm|xltx|xlsb|xls|ods)$/i;
const DOCUMENT_EXT = /\.(docx|docm|dotx)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|flac|m4a)$/i;

/** The type a media blob is given before the browser shows it: ours, never whatever the bytes claim. */
export const MEDIA_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
};

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';

export function previewKindOf(name: string): PreviewKind {
  if (isImageName(name)) return 'image';
  if (/\.pdf$/i.test(name)) return 'pdf';
  if (VIDEO_EXT.test(name)) return 'video';
  if (AUDIO_EXT.test(name)) return 'audio';
  if (SPREADSHEET_EXT.test(name)) return 'spreadsheet';
  if (DOCUMENT_EXT.test(name)) return 'document';
  if (isMarkdownName(name)) return 'markdown';
  if (/\.html?$/i.test(name)) return 'html';
  if (isTextName(name)) return 'text';
  return 'none';
}

/** Whether a file gets a hover card at all: only the kinds a glance can show, and not too big. */
export const hasHoverPreview = (entry: { name: string; size: number }) => {
  const kind = previewKindOf(entry.name);
  return kind !== 'video' && kind !== 'audio' && entry.size > 0 && canPreview(kind, entry.size, 'hover');
};

const MB = 1024 * 1024;

/**
 * Everything but photos is downloaded whole and handled in the browser (office
 * files are even parsed there), so a big file is stopped before it locks up the
 * tab. The hover preview is a glance: it takes smaller files still, and no media.
 */
const LIMITS: Record<'full' | 'hover', Partial<Record<PreviewKind, number>>> = {
  full: { pdf: 50 * MB, video: 50 * MB, audio: 50 * MB, spreadsheet: 20 * MB, document: 20 * MB, markdown: 512 * 1024, html: 512 * 1024, text: 512 * 1024 },
  hover: { pdf: 15 * MB, spreadsheet: 8 * MB, document: 8 * MB, markdown: 512 * 1024, html: 512 * 1024, text: 512 * 1024 },
};

/** Whether a file of this kind and size can be shown; images always can (the server sends them inline). */
export function canPreview(kind: PreviewKind, size: number, variant: 'full' | 'hover'): boolean {
  if (kind === 'image') return true;
  const limit = LIMITS[variant][kind];
  return limit !== undefined && size <= limit;
}

/** The last few files fetched, so hovering and then opening a file downloads it once. */
const CACHE_SIZE = 6;
const cache = new Map<string, Promise<Blob>>();

export function loadFile(path: string, version: string): Promise<Blob> {
  const key = `${path}\u0000${version}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = fetch(fileUrl(path), { credentials: 'include' }).then((res) =>
    res.ok ? res.blob() : Promise.reject(new Error(String(res.status))),
  );
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return pending;
}

export type FileState = { blob: Blob; error?: undefined } | { blob?: undefined; error: unknown } | null;

/** The file's bytes, or the error that stopped them; null while loading. */
export function useFileBlob(path: string, version: string, enabled = true): FileState {
  const key = `${path}\u0000${version}`;
  const [state, setState] = useState<{ key: string; value: NonNullable<FileState> } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    loadFile(path, version).then(
      (blob) => !cancelled && setState({ key, value: { blob } }),
      (error: unknown) => !cancelled && setState({ key, value: { error } }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, version, enabled, key]);

  return state?.key === key ? state.value : null;
}

/**
 * Points an iframe or media element at the blob, typed by us, through an object
 * URL that is revoked when the element goes away.
 */
export function useBlobSrc<T extends HTMLIFrameElement | HTMLMediaElement>(blob: Blob | undefined, type: string, suffix = '') {
  const ref = useRef<T>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !blob) return;
    const url = URL.createObjectURL(new Blob([blob], { type }));
    element.src = url + suffix;
    return () => URL.revokeObjectURL(url);
  }, [blob, type, suffix]);
  return ref;
}
