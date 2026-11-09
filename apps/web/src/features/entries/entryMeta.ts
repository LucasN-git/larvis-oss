import {
  FileText,
  Globe,
  Hash,
  Instagram,
  Link2,
  Linkedin,
  Music,
  Paperclip,
  Podcast,
  Twitter,
  Youtube,
  type LucideIcon,
} from 'lucide-react';
import type { Entry, Learning, LearningSource, SourceMediaType, SourcePlatform } from '@larvis/shared';

// Darstellungs-Konstanten für Einträge: ein Icon pro Plattform, dazu die kleinen
// Formatierer für Länge und Plattform. Bereiche sind frei vergebener Text und tragen alle
// dasselbe neutrale Icon.

/** Das eine Icon für jeden Bereich (Einträge und Wiki). */
export const AreaIcon: LucideIcon = Hash;

export const PLATFORM_ICONS: Record<SourcePlatform, LucideIcon> = {
  instagram: Instagram,
  youtube: Youtube,
  tiktok: Music,
  x: Twitter,
  linkedin: Linkedin,
  web: Globe,
  podcast: Podcast,
  pdf: FileText,
  upload: Paperclip,
  other: Link2,
};

export const PLATFORM_LABELS: Record<SourcePlatform, string> = {
  instagram: 'Instagram',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  x: 'X',
  linkedin: 'LinkedIn',
  web: 'Web',
  podcast: 'Podcast',
  pdf: 'PDF',
  upload: 'Datei',
  other: 'Sonstiges',
};

export const MEDIA_TYPE_LABELS: Record<SourceMediaType, string> = {
  video: 'Video',
  image: 'Bild',
  carousel: 'Carousel',
  text: 'Text',
  audio: 'Audio',
  document: 'Dokument',
};

/** "0:55" · "24 min" · "1.200 Wörter" · "12 S." — je nachdem, was die Quelle hergibt. */
export function formatLength(e: Pick<Entry, 'source_duration_seconds' | 'source_word_count' | 'source_page_count'>): string | null {
  const s = e.source_duration_seconds;
  if (s != null) {
    if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return `${Math.round(s / 60)} min`;
  }
  if (e.source_word_count != null) return `${e.source_word_count.toLocaleString('de-DE')} Wörter`;
  if (e.source_page_count != null) return `${e.source_page_count} S.`;
  return null;
}

/** Plattform aus dem Host der URL, für Einträge, die von Hand angelegt werden. */
export function guessPlatform(url: string): SourcePlatform | null {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host.endsWith('instagram.com')) return 'instagram';
  if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  if (host.endsWith('tiktok.com')) return 'tiktok';
  if (host === 'x.com' || host.endsWith('twitter.com')) return 'x';
  if (host.endsWith('linkedin.com') || host === 'lnkd.in') return 'linkedin';
  if (url.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'web';
}

/** Die Quelle als öffnbarer Link: http(s) oder „www.…" — freie Angaben wie „Buch XY" ergeben null. */
export function linkHref(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u || /\s/.test(u)) return null;
  if (/^https?:\/\//i.test(u)) return u;
  if (/^www\./i.test(u)) return `https://${u}`;
  return null;
}

/** Ein Learning, in das ein Eintrag einfließt, zusammen mit dem Beleg (Rolle, Kommentar), der beide verbindet. */
export interface EntryLearningLink {
  source: LearningSource;
  learning: Pick<Learning, 'id' | 'slug' | 'title' | 'area'>;
}

/**
 * Liest die Belege umgekehrt: zu jedem Eintrag die Learnings, in die er einfließt, in der
 * Reihenfolge der Belege. Belege auf gelöschte Seiten fallen weg, weil listLearnings nur
 * live Seiten liefert; Belege einer Notiz haben keinen Eintrag und zählen hier nicht.
 */
export function learningsByEntry(sources: LearningSource[], learnings: Learning[]): Map<string, EntryLearningLink[]> {
  const byId = new Map(learnings.map((l) => [l.id, l]));
  const map = new Map<string, EntryLearningLink[]>();
  for (const source of sources) {
    if (!source.entry_id) continue;
    const learning = byId.get(source.learning_id);
    if (!learning) continue;
    let list = map.get(source.entry_id);
    if (!list) map.set(source.entry_id, (list = []));
    list.push({ source, learning });
  }
  return map;
}
