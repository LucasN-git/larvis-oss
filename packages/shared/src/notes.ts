import type { Note, NoteNode } from './types.js';
import { buildTree, flattenTree } from './tree.js';

// Inline attachment references. A pasted screenshot is stored as a standard
// markdown image whose URL is an app-internal ref, e.g.
//   ![grafik.png](larvis-att:8f3c…#w=480)
// The web app resolves the ref to a short-lived signed URL at render time and
// reads/writes the optional `#w=NNN` (display width in px) when resizing.
export const ATTACHMENT_SCHEME = 'larvis-att:';

/** Build the body reference for an inline image attachment. */
export function attachmentRef(id: string, width?: number): string {
  return `${ATTACHMENT_SCHEME}${id}${width ? `#w=${Math.round(width)}` : ''}`;
}

/** Parse a `larvis-att:` reference into its attachment id + optional width. */
export function parseAttachmentRef(src: string): { id: string; width?: number } | null {
  if (!src.startsWith(ATTACHMENT_SCHEME)) return null;
  const [idPart, hash = ''] = src.slice(ATTACHMENT_SCHEME.length).split('#');
  const id = idPart.trim();
  if (!id) return null;
  const m = hash.match(/w=(\d+)/);
  return { id, width: m ? Number(m[1]) : undefined };
}

/**
 * Rewrite the display width of an inline image ref inside a markdown body.
 * Matches the attachment id inside any `(larvis-att:<id>…)`, replacing (or
 * adding) the `#w=` fragment. `width = null` removes the width (natural size).
 */
export function setInlineImageWidth(body: string, id: string, width: number | null): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(\\(\\s*${ATTACHMENT_SCHEME}${esc})(#w=\\d+)?(\\s*\\))`, 'g');
  return body.replace(re, (_m, head, _w, tail) => `${head}${width ? `#w=${Math.round(width)}` : ''}${tail}`);
}

/** Remove an inline image (its whole `![…](larvis-att:<id>…)`) from a body. */
export function removeInlineImage(body: string, id: string): string {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`!\\[[^\\]]*\\]\\(\\s*${ATTACHMENT_SCHEME}${esc}(?:#[^)\\s]*)?\\s*\\)`, 'g');
  return body.replace(re, '').replace(/\n{3,}/g, '\n\n');
}

/** Folder tree of notes (thin wrapper over the generic tree helpers). */
export function buildNoteTree(notes: Note[]): NoteNode[] {
  return buildTree(notes);
}

/** Flatten a note tree to a depth-annotated list (for indented rendering). */
export function flattenNoteTree(nodes: NoteNode[], depth = 0): { node: NoteNode; depth: number }[] {
  return flattenTree(nodes, depth);
}
