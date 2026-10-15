import { useCallback, useEffect, useRef, useState } from 'react';
import { filesApi } from '../../api/account';
import { ApiError } from '../../api/client';
import { MAX_ATTACHMENTS, isImageName, uploadFolder, type DraftAttachment } from './attachments';

let seq = 0;
const nextId = () => `att-${Date.now().toString(36)}-${++seq}`;

/** Pasted screenshots all arrive as "image.png": give each one its own name. */
function fileName(file: File): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
  return `pasted-${stamp}-${++seq}.${ext}`;
}

/**
 * The files waiting in the composer: each one uploads to the workspace as soon
 * as it is added (`Chat uploads/<day>`), so sending only passes their paths.
 */
export function useDraftAttachments() {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const uploads = useRef(new Map<string, AbortController>());
  // Mirrors `items` for the handlers below, which run outside render.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const patch = useCallback((id: string, change: Partial<DraftAttachment>) => setItems((prev) => prev.map((a) => (a.id === id ? { ...a, ...change } : a))), []);

  /** Adds files from the picker, a drop or a paste; returns how many did not fit. */
  const add = useCallback((files: File[]): number => {
    const room = MAX_ATTACHMENTS - itemsRef.current.length;
    const taken = files.slice(0, Math.max(0, room));
    if (!taken.length) return files.length;
    const used = new Set(itemsRef.current.map((a) => a.name));
    const folder = uploadFolder();
    const added = taken.map((file) => {
      let name = fileName(file);
      // Two files with one name in one message would overwrite each other.
      for (let n = 2; used.has(name); n++) name = name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
      used.add(name);
      const image = file.type.startsWith('image/') || isImageName(name);
      const item: DraftAttachment = { id: nextId(), name, kind: image ? 'image' : 'file', size: file.size, path: null, progress: 0, error: null, preview: image ? URL.createObjectURL(file) : null };
      return { item, file };
    });
    const list = [...itemsRef.current, ...added.map((a) => a.item)];
    itemsRef.current = list;
    setItems(list);

    void filesApi
      .mkdir(folder)
      .catch(() => undefined)
      .then(() => {
        for (const { item, file: picked } of added) {
          const controller = new AbortController();
          uploads.current.set(item.id, controller);
          const file = item.name === picked.name ? picked : new File([picked], item.name, { type: picked.type });
          filesApi
            .uploadWithProgress(folder, file, (progress) => patch(item.id, { progress }), controller.signal)
            .then((entry) => patch(item.id, { path: entry.path, progress: 1 }))
            .catch((err) => {
              if (controller.signal.aborted) return;
              patch(item.id, { error: err instanceof ApiError && err.message ? err.message : String(err) });
            })
            .finally(() => uploads.current.delete(item.id));
        }
      });
    return files.length - taken.length;
  }, [patch]);

  /** A file already in the workspace (from the files panel): nothing to upload. */
  const addExisting = useCallback((entry: { path: string; name: string; size: number }): boolean => {
    const current = itemsRef.current;
    if (current.some((a) => a.path === entry.path)) return true;
    if (current.length >= MAX_ATTACHMENTS) return false;
    const list = [...current, { id: nextId(), name: entry.name, kind: isImageName(entry.name) ? ('image' as const) : ('file' as const), size: entry.size, path: entry.path, progress: 1, error: null, preview: null }];
    itemsRef.current = list;
    setItems(list);
    return true;
  }, []);

  const remove = useCallback((id: string) => {
    uploads.current.get(id)?.abort();
    const gone = itemsRef.current.find((a) => a.id === id);
    if (gone?.preview) URL.revokeObjectURL(gone.preview);
    setItems((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /** After sending: the message now shows the files from the workspace. */
  const clear = useCallback(() => {
    for (const a of itemsRef.current) if (a.preview) URL.revokeObjectURL(a.preview);
    itemsRef.current = [];
    setItems([]);
  }, []);

  // Leaving the page stops uploads in flight and frees the local previews.
  useEffect(() => {
    const inFlight = uploads.current;
    const latest = itemsRef;
    return () => {
      for (const controller of inFlight.values()) controller.abort();
      for (const a of latest.current) if (a.preview) URL.revokeObjectURL(a.preview);
    };
  }, []);

  return {
    items,
    add,
    addExisting,
    remove,
    clear,
    /** Workspace paths of the files ready to send. */
    paths: items.filter((a) => a.path).map((a) => a.path!),
    uploading: items.some((a) => !a.path && !a.error),
  };
}
