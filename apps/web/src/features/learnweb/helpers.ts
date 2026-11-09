import {
  CalendarClock,
  FileText,
  Folder,
  Link2,
  MessagesSquare,
  StickyNote,
  Video,
  type LucideIcon,
} from 'lucide-react';
import type { LearnwebCourse, LearnwebVideoStatus } from '@larvis/shared';

/** Sekunden -> „1:50 h" bzw. „50 min". */
export function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return '';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours}:${String(mins).padStart(2, '0')} h` : `${mins} min`;
}

/**
 * „Neu"-Marker: erst kürzlich gesehen (< 7 Tage) UND mehr als eine Stunde nach
 * dem Erstkontakt mit dem Kurs — unterdrückt die Flut beim allerersten Sync.
 */
export function isNewSince(firstSeenAt: string, courseFirstSeenAt: string | undefined): boolean {
  const seen = Date.parse(firstSeenAt);
  if (Number.isNaN(seen)) return false;
  const recent = Date.now() - seen < 7 * 86400_000;
  if (!recent) return false;
  if (!courseFirstSeenAt) return true;
  const courseSeen = Date.parse(courseFirstSeenAt);
  return Number.isNaN(courseSeen) ? true : seen > courseSeen + 3600_000;
}

/** Icon je Moodle-Modultyp. */
export function modtypeIcon(modtype: string): LucideIcon {
  switch (modtype) {
    case 'resource':
      return FileText;
    case 'folder':
      return Folder;
    case 'forum':
      return MessagesSquare;
    case 'url':
      return Link2;
    case 'opencast':
      return Video;
    case 'page':
    case 'label':
      return StickyNote;
    default:
      return CalendarClock;
  }
}

/** Ein Semester als Gruppierungs-Einheit; sortKey höher = neuer, -1 = "Sonstige". */
export interface Semester {
  key: string;
  label: string;
  sortKey: number;
}

const soSe = (year: number): Semester => ({
  key: `sose-${year}`,
  label: `SoSe ${year}`,
  sortKey: year * 2,
});

const wiSe = (year: number): Semester => ({
  key: `wise-${year}`,
  label: `WiSe ${year}/${String((year + 1) % 100).padStart(2, '0')}`,
  sortKey: year * 2 + 1,
});

export const OTHER_SEMESTER: Semester = { key: 'other', label: 'Sonstige', sortKey: -1 };

/** 2-stellige Jahresangaben ("SoSe 24") auf 20xx normalisieren. */
const fullYear = (raw: string): number => {
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
};

/**
 * Semester eines Kurses bestimmen. Reihenfolge: Shortname-Suffix des
 * Learnweb-Namensschemas ("KURS-2026_1": _1 = SoSe, _2 = WiSe), dann
 * Semester-Angabe im Namen ("SoSe 2026", "WiSe 2025/26", "Summer Term 2025"),
 * zuletzt das Startdatum. Dauerkurse ohne Semesterbezug (Platzhalter-Startdatum
 * vor 2010, z. B. LearningCenter) landen in "Sonstige".
 */
export function courseSemester(
  course: Pick<LearnwebCourse, 'fullname' | 'shortname' | 'startdate'>,
): Semester {
  const suffix = /(\d{4})_([12])\s*$/.exec(course.shortname ?? '');
  if (suffix) return suffix[2] === '1' ? soSe(Number(suffix[1])) : wiSe(Number(suffix[1]));

  const text = `${course.fullname} ${course.shortname ?? ''}`;
  const summer = /\b(?:SoSe|Sommersemester|Summer\s*Term|SS|ST)\s*(\d{4}|\d{2})\b/i.exec(text);
  if (summer) return soSe(fullYear(summer[1]));
  const winter = /\b(?:WiSe|Wintersemester|Winter\s*Term|WS|WT)\s*(\d{4}|\d{2})\b/i.exec(text);
  if (winter) return wiSe(fullYear(winter[1]));

  if (course.startdate) {
    // Startdaten stehen als UTC-Mitternacht des Vortags in der DB (+2h Berlin);
    // 6h Puffer schiebt sie sicher auf den lokalen Kalendertag.
    const d = new Date(Date.parse(course.startdate) + 6 * 3600_000);
    const year = d.getUTCFullYear();
    if (year >= 2010) {
      const month = d.getUTCMonth() + 1;
      if (month >= 4 && month <= 9) return soSe(year);
      return month >= 10 ? wiSe(year) : wiSe(year - 1);
    }
  }
  return OTHER_SEMESTER;
}

/** Das heute laufende Semester (SoSe: April–September, sonst WiSe). */
export function currentSemester(now: Date = new Date()): Semester {
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4 && month <= 9) return soSe(year);
  return month >= 10 ? wiSe(year) : wiSe(year - 1);
}

/** Badge-Ton je Transkript-Status. */
export function statusTone(
  status: LearnwebVideoStatus,
): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'transcribing':
    case 'done':
      return 'accent';
    case 'failed':
      return 'danger';
    case 'queued':
      return 'warning';
    default:
      return 'default';
  }
}
