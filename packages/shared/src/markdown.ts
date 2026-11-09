// Pure markdown helpers shared by the web app and MCP server.
// Rendering happens in the web app (react-markdown); these are lightweight
// text utilities for titles, previews, slugs and task checkboxes.

/** Derive a human title from a markdown body (first heading or first line). */
export function titleFromMarkdown(md: string, fallback = 'Untitled'): string {
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    return (heading ? heading[1] : line).replace(/[*_`>#-]/g, '').trim() || fallback;
  }
  return fallback;
}

/** Strip markdown syntax to plain text, for previews and search snippets. */
export function markdownToPlain(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ') // code fences
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, '') // headings/lists/quotes
    .replace(/[*_~`]/g, '') // emphasis / inline code marks
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short single-line preview of a markdown body. */
export function previewOf(md: string, max = 140): string {
  const plain = markdownToPlain(md);
  return plain.length > max ? plain.slice(0, max - 1).trimEnd() + '…' : plain;
}

/** URL/identifier-safe slug from arbitrary text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 64) || 'untitled';
}

export interface TaskCheckbox {
  checked: boolean;
  label: string;
  line: number;
}

/** Parse GFM task list items (`- [ ]` / `- [x]`) from a markdown body. */
export function parseTaskCheckboxes(md: string): TaskCheckbox[] {
  const out: TaskCheckbox[] = [];
  md.split('\n').forEach((line, i) => {
    const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
    if (m) out.push({ checked: m[1].toLowerCase() === 'x', label: m[2].trim(), line: i });
  });
  return out;
}
