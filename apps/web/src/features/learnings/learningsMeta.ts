import { NotebookPen, type LucideIcon } from 'lucide-react';
import { LEARNING_SOURCE_ROLES, type Entry, type LearningSource, type LearningSourceRole, type Note } from '@larvis/shared';
import { AreaIcon, linkHref } from '../entries/entryMeta';

/** Übersicht eines Wiki-Bereichs; der Bereich ist freier Text und wird deshalb kodiert. */
export function areaHref(area: string): string {
  return area ? `/learnings?area=${encodeURIComponent(area)}` : '/learnings';
}

/**
 * Ein Beleg samt der Quelle, auf die er zeigt, fertig für die Anzeige. `href` ist bei
 * Einträgen die externe URL (falls vorhanden), bei Notizen die Notizen- bzw. Archiv-Route.
 */
export interface ResolvedSource {
  source: LearningSource;
  kind: 'entry' | 'note';
  title: string;
  icon: LucideIcon;
  href: string | null;
  external: boolean;
}

/**
 * Belege mit ihren Quellen verbinden. Eine Quelle, die nicht in den Live-Listen steht
 * (gelöscht oder noch nicht geladen), fällt heraus — ein Beleg ohne Quelle zeigt nichts.
 */
export function resolveSources(
  sources: LearningSource[],
  entries: Map<string, Entry>,
  notes: Map<string, Note>,
): ResolvedSource[] {
  const out: ResolvedSource[] = [];
  for (const source of sources) {
    if (source.entry_id) {
      const entry = entries.get(source.entry_id);
      if (!entry || entry.deleted_at) continue;
      const href = linkHref(entry.url);
      out.push({ source, kind: 'entry', title: entry.name, icon: AreaIcon, href, external: Boolean(href) });
    } else if (source.note_id) {
      const note = notes.get(source.note_id);
      if (!note || note.deleted_at) continue;
      out.push({ source, kind: 'note', title: note.title || 'Ohne Titel', icon: NotebookPen, href: note.archived_at ? '/archiv' : note.project_id ? `/projects/${note.project_id}` : '/projects', external: false });
    }
  }
  return out;
}

/** Belege nach Rolle gruppiert, in der festen Reihenfolge der Rollen; leere Gruppen fehlen. */
export function groupByRole(items: ResolvedSource[]): { role: LearningSourceRole; items: ResolvedSource[] }[] {
  return LEARNING_SOURCE_ROLES.map((role) => ({ role, items: items.filter((i) => i.source.role === role) })).filter(
    (g) => g.items.length > 0,
  );
}
