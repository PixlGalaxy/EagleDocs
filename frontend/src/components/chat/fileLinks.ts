import { fileUrl, workspaceLinkPath } from './attachments';

/** Cards after one paragraph or list item, at most this many. */
const MAX_CARDS = 3;
const DOWNLOAD = fileUrl('').split('?')[0]!;

/** The workspace path a rendered link points to (a download link, or a workspace: link as written), or null. */
function filePathOf(href: unknown): string | null {
  if (typeof href !== 'string' || !href) return null;
  if (href.startsWith(`${DOWNLOAD}?`)) return new URLSearchParams(href.slice(DOWNLOAD.length + 1)).get('path');
  return workspaceLinkPath(href);
}

/** The parts of a markdown node these helpers read (hast elements and text). */
interface MdNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: MdNode[];
}

/**
 * The workspace files a paragraph or list item links to, in order and once
 * each. Lists inside it are left to their own items; pictures already show inline.
 */
export function linkedFilesIn(node: MdNode | undefined): string[] {
  const out: string[] = [];
  const walk = (n: MdNode) => {
    if (n.type !== 'element') return;
    if (n.tagName === 'ul' || n.tagName === 'ol') return;
    if (n.tagName === 'a') {
      const path = filePathOf(n.properties?.href);
      if (path && !out.includes(path)) out.push(path);
      return;
    }
    n.children?.forEach(walk);
  };
  node?.children?.forEach(walk);
  return out.slice(0, MAX_CARDS);
}
