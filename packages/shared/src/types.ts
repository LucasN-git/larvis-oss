// Canonical domain types for Larvis.
// Shapes are snake_case to match the Supabase row columns directly — no mapping layer.
// Used by both the web app and the MCP server.

export const AREAS = ['project', 'personal'] as const;
export type Area = (typeof AREAS)[number];

export const PROJECT_STATUSES = ['active', 'paused', 'done', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Anzeigenamen der Projekt-Status — eine Quelle für Web-App und MCP-Tool-Beschreibung. */
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Aktiv',
  paused: 'Inaktiv',
  done: 'Fertig',
  archived: 'Archiviert',
};

/** Aktiv = erscheint als Kachel; alles andere (außer archiviert) landet im Inaktiv-Bereich. */
export function isProjectActive(p: Pick<Project, 'status'>): boolean {
  return p.status === 'active';
}

export const TODO_STATUSES = ['todo', 'doing', 'done'] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export const AGENT_TASK_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type AgentTaskStatus = (typeof AGENT_TASK_STATUSES)[number];

/** 0 = none, 1 = low, 2 = medium, 3 = high */
export type Priority = 0 | 1 | 2 | 3;

/**
 * Bereich (area) eines Eintrags oder einer Wiki-Seite: ein frei vergebener, kurzer Text wie
 * „kochen" oder „reisen". Es gibt keine vordefinierten Bereiche; die Liste der Bereiche ist
 * die Menge der Werte, die in der Datenbank vorkommen. Gespeichert wird die normalisierte
 * Form (klein, getrimmt, einfache Leerzeichen, höchstens AREA_MAX_LENGTH Zeichen), angezeigt
 * wird genau dieser Text. Ein Eintrag liegt dort, wo man ihn suchen würde; die Form eines
 * Fundes — etwas zum Nachmachen, eine Idee — ist kein Bereich, sondern ein Tag.
 */
export const AREA_MAX_LENGTH = 40;

/** Normalisiert einen Bereich; '' heißt: kein gültiger Bereich. */
export function normalizeArea(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase().slice(0, AREA_MAX_LENGTH).trim();
}

/** Normalisiert eine Liste weiterer Bereiche: ohne Leere, ohne Dubletten, ohne den Hauptbereich. */
export function normalizeAreas(values: readonly string[], main?: string): string[] {
  const mainNorm = main ? normalizeArea(main) : '';
  const out: string[] = [];
  for (const v of values) {
    const a = normalizeArea(v);
    if (a && a !== mainNorm && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Liegt der Eintrag (als Haupt- oder weiterer Bereich) im Bereich `area`? */
export function entryInArea(e: Pick<Entry, 'area' | 'also_areas'>, area: string): boolean {
  return e.area === area || (e.also_areas ?? []).includes(area);
}

/** Ein vorhandener Bereich mit der Zahl der Zeilen, die ihn tragen. */
export interface AreaCount {
  area: string;
  count: number;
}

/**
 * Die vorhandenen Bereiche aus Zeilen mit Haupt- und optional weiteren Bereichen, häufigste
 * zuerst, bei Gleichstand alphabetisch. Eine Zeile zählt je Bereich höchstens einmal.
 */
export function collectAreas(rows: readonly { area: string; also_areas?: readonly string[] | null }[]): AreaCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const a of new Set([r.area, ...(r.also_areas ?? [])])) {
      if (a) counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([area, count]) => ({ area, count }))
    .sort((x, y) => y.count - x.count || x.area.localeCompare(y.area, 'de'));
}

/** Form eines Fundes als Tag (kein Bereich): zum Nachmachen bzw. eine Idee. */
export const ENTRY_FORM_TAGS = ['nachmachen', 'idee'] as const;

/** Woher die Quelle stammt; 'other' für alles, was keinen eigenen Wert hat. */
export const SOURCE_PLATFORMS = [
  'instagram',
  'youtube',
  'tiktok',
  'x',
  'linkedin',
  'web',
  'podcast',
  'pdf',
  'upload',
  'other',
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SOURCE_MEDIA_TYPES = ['video', 'image', 'carousel', 'text', 'audio', 'document'] as const;
export type SourceMediaType = (typeof SOURCE_MEDIA_TYPES)[number];

export const MEMORY_KINDS = ['user', 'feedback', 'project', 'reference', 'skill'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

/** Anzeigenamen der Memory-Arten — eine Quelle für Web-App und MCP-Tool-Beschreibung. */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  user: 'Über mich',
  feedback: 'Arbeitsweise',
  project: 'Projekte',
  reference: 'Referenzen',
  skill: 'Skills',
};

/**
 * Learnings: das kuratierte Wiki (Tab „Learnings"). Einträge sind fremde Funde, Notizen
 * eigene Erfahrung; ein Learning ist die eigene Aussage, die daraus entsteht — ganze Sätze,
 * aktueller Zustand, mit Grafiken und mit Belegen (LearningSource). Der Bereich (area) ist
 * die oberste Ebene, darunter ein Seitenbaum. Bereiche sind frei vergeben wie bei Einträgen
 * (siehe normalizeArea); ein Learning liegt in dem Gebiet, in dem seine Aussage gilt.
 */

/**
 * Rolle eines Belegs am Learning: stützt die Quelle die Aussage, zeigt sie sie an einem
 * Fall, widerspricht sie ihr, oder ist sie eigene Beobachtung (typisch eine Notiz).
 */
export const LEARNING_SOURCE_ROLES = ['beleg', 'beispiel', 'gegenbeispiel', 'erfahrung'] as const;
export type LearningSourceRole = (typeof LEARNING_SOURCE_ROLES)[number];

export const LEARNING_SOURCE_ROLE_LABELS: Record<LearningSourceRole, string> = {
  beleg: 'Beleg',
  beispiel: 'Beispiel',
  gegenbeispiel: 'Gegenbeispiel',
  erfahrung: 'Eigene Erfahrung',
};

/**
 * Slug-Regel für Learnings (auch als DB-Check): kebab-case, ASCII. Der Slug ist die
 * stabile Adresse (URL, Upsert-Schlüssel, interne Links) und bleibt nach dem Anlegen.
 */
export const LEARNING_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface Project {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  description_md: string;
  status: ProjectStatus;
  color: string | null;
  icon: string | null;
  /** Absolute path to the project's folder on the owner's local machine (for "open folder" deep links). */
  local_path: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

/** Datei im privaten Bucket `uploads`; Dump-Item und daraus entstandener Eintrag zeigen auf dieselbe Zeile. */
export interface Upload {
  id: string;
  /** Pfad im Bucket: <owner_uid>/<upload_id>.<ext> */
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  /** Nur der MCP-Lesepfad (list_inbox) setzt das: signierte URL, ~6 h gültig; null, wenn das Signieren scheiterte. */
  signed_url?: string | null;
}

export interface InboxItem {
  id: string;
  content: string;
  processed: boolean;
  created_at: string;
  processed_at: string | null;
  /** Wann Claude das Item angesehen hat; null = noch nicht gescannt. Unabhängig von processed. */
  scanned_at: string | null;
  /** Eine Zeile von Claude, was aus dem Scan wurde. */
  scan_note: string | null;
  upload_id: string | null;
  /** Nur gesetzt, wenn die Query den Embed `upload:uploads(...)` mitselektiert. */
  upload?: Upload | null;
  /** Eigener Kommentar beim Speichern (Kurzbefehl, Web-Dump): warum, was daran wichtig ist. null = keiner. */
  note: string | null;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

/** Vom Cron erzeugtes Tages-Briefing (eine Zeile pro Tag, `date` = lokales Datum). */
export interface Briefing {
  id: string;
  /** ISO-Datum (YYYY-MM-DD), Europe/Berlin. */
  date: string;
  content_md: string;
  model: string | null;
  /** Wann der Nutzer das Briefing abgehakt hat; null = ungelesen (Card auf "Heute" sichtbar). */
  read_at: string | null;
  created_at: string;
}

export interface Todo {
  id: string;
  project_id: string | null;
  area: Area;
  title: string;
  body_md: string;
  status: TodoStatus;
  priority: Priority;
  /** Low-priority todo parked in the backlog. Hidden from Heute and the main list. */
  backlog: boolean;
  /** Due timestamp. A due date of today (or earlier) puts the todo on the Heute page;
   *  a UTC-midnight time means "all-day", any other time is a concrete slot. */
  due_at: string | null;
  completed_at: string | null;
  tags: string[];
  /** Google Calendar event id when this todo is mirrored into the Larvis calendar. */
  gcal_event_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

export interface Note {
  id: string;
  project_id: string | null;
  /** Parent note for the folder tree. null = top level within the project. */
  parent_id: string | null;
  area: Area;
  title: string;
  body_md: string;
  tags: string[];
  /** Order among siblings (same parent_id within a project). */
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Archiv-Stufe: gesetzt = archiviert (im Archiv sichtbar, aus dem Hauptbereich ausgeblendet). null = live. */
  archived_at: string | null;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
  /** Emoji, das die Notiz im Baum und im Kopf trägt (statt des generischen Datei-Icons). null = keins. */
  icon: string | null;
  /** Serie der Notiz: alle Versionen teilen sie; ohne Vorgänger ist die Notiz ihre eigene Serie. */
  series_id: string;
  version_no: number;
  /** Vorlage dieser Version; null bei der ersten. */
  previous_version_id: string | null;
  /** Gesetzt, wenn eine neuere Version existiert (eingefroren, nur lesbar). null = aktuell. */
  superseded_at: string | null;
  /** Themen-Graph (Knoten und Kanten), in der App interaktiv gezeichnet. null = keiner. */
  graph: NoteGraph | null;
}

/** Ein Knoten im Themen-Graph einer Notiz. */
export interface NoteGraphNode {
  /** Stabiler Schlüssel, kebab-case, eindeutig innerhalb des Graphen; Kanten verweisen darauf. */
  id: string;
  label: string;
  /** Gruppe für Farbe und Legende, z. B. „grundlagen", „werkzeuge", „beispiele"; frei wählbar, gleiche Gruppe = gleiche Farbe. */
  group?: string;
  /** Ein bis drei Sätze, die beim Anklicken erscheinen; Markdown. */
  note?: string;
  /** Gewicht 1–5: steuert die Knotengröße. Fehlt es, gilt 3. */
  weight?: number;
  /** Position aus dem letzten Verschieben in der App. Fehlt sie, legt das Auto-Layout den Knoten. */
  x?: number;
  y?: number;
}

/** Eine gerichtete Kante im Themen-Graph. */
export interface NoteGraphEdge {
  from: string;
  to: string;
  /** Kurze Beschriftung der Beziehung, z. B. „treibt", „ersetzt", „Gegenbild zu". */
  label?: string;
}

/** Themen-Graph einer Notiz. */
export interface NoteGraph {
  nodes: NoteGraphNode[];
  edges: NoteGraphEdge[];
  /** Freitext zur Legende der Gruppen, optional: group → Beschriftung. */
  groups?: Record<string, string>;
}

export type AttachmentKind = 'image' | 'file';

/**
 * Gemeinsame Gestalt aller Datei-Anhänge (Notizen, Learnings): die Datei liegt in einem
 * privaten Storage-Bucket, die Zeile hält Metadaten + Storage-Pfad. `inline` markiert
 * Bilder, die im Markdown-Body stehen (als `larvis-att:<id>` referenziert). UI-Bausteine
 * wie das Anhänge-Panel arbeiten auf dieser Gestalt und sind damit tabellenunabhängig.
 */
export interface AttachmentLike {
  id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  kind: AttachmentKind;
  inline: boolean;
  sort_order: number;
  created_at: string;
}

/** A file or image attached to a note. Binary in the private `note-files` bucket. */
export interface NoteAttachment extends AttachmentLike {
  note_id: string;
}

/**
 * Eine Wiki-Seite. `slug` ist die stabile Adresse (URL /learnings/<slug>, Upsert-Schlüssel
 * für Claude, Ziel interner Links) und nach dem Anlegen unveränderlich. Worauf sich die
 * Seite stützt, hängt als LearningSource daran.
 */
export interface Learning {
  id: string;
  /** Bereich (frei vergeben, normalisiert), oberste Ebene des Wikis. */
  area: string;
  /** Elternseite im Baum des Bereichs. null = oberste Ebene. */
  parent_id: string | null;
  slug: string;
  title: string;
  /** Kurzer Teaser unter dem Titel. */
  summary: string | null;
  body_md: string;
  tags: string[];
  /** Reihenfolge unter Geschwistern (gleiche parent_id im Bereich). */
  sort_order: number;
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

/**
 * Ein Beleg eines Learnings: genau eine Quelle (Eintrag oder Notiz) mit ihrer Rolle und
 * optional einem Satz, was sie für die Aussage zeigt. Dieselbe Quelle hängt an einer Seite
 * höchstens einmal. Umgekehrt gelesen: ein Eintrag mit Belegen „fließt ein in" Learnings.
 */
export interface LearningSource {
  id: string;
  learning_id: string;
  entry_id: string | null;
  note_id: string | null;
  role: LearningSourceRole;
  comment: string;
  sort_order: number;
  created_at: string;
}

/** Grafik oder Datei einer Wiki-Seite. Binary im privaten `learning-files`-Bucket. */
export interface LearningAttachment extends AttachmentLike {
  learning_id: string;
}

export interface Item {
  id: string;
  name: string;
  location: string;
  category: string | null;
  notes_md: string;
  area: Area;
  project_id: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

export const CONTACT_SOURCES = ['manual', 'vcard', 'linkedin', 'whatsapp'] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/**
 * Ein Wert in einem mehrwertigen Kontaktfeld: {label: 'mobil', value: '+49 …'}.
 * Bewusst type statt interface: nur Aliase bekommen die implizite Index-Signatur,
 * die sie an die Json-Spalten der generierten Supabase-Types assignable macht.
 */
export type ContactHandle = {
  label: string;
  value: string;
};

export type ContactLink = {
  label: string;
  url: string;
};

/**
 * Kontakt im persönlichen Adressbuch. Befüllt aus vCard- und LinkedIn-Export
 * plus manueller Pflege; source hält die ursprüngliche Quelle fest.
 */
export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  nickname: string | null;
  /** ISO-Datum. Bei unbekanntem Jahr steht das Apple-Platzhalterjahr 1604 drin. */
  birthday: string | null;
  /** false = nur Tag+Monat bekannt (UI zeigt kein Jahr/Alter). */
  birthday_year_known: boolean;
  /** Privat/Business-Toggle: true = beruflicher Kontakt. Eine Tabelle, zwei Views. */
  business: boolean;
  phones: ContactHandle[];
  emails: ContactHandle[];
  addresses: ContactHandle[];
  company: string | null;
  position: string | null;
  /** Was die Person gerade macht (Freitext, eine Zeile). */
  current_status: string;
  linkedin_url: string | null;
  links: ContactLink[];
  tags: string[];
  /** Freitext-Notizen zur Person (Markdown). */
  notes_md: string;
  source: ContactSource;
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

/**
 * Ein abgelegter Fund — Artikel, Video, Post, Podcast, PDF oder eine Idee von Hand.
 * Eine Quelle darf mehrere Einträge erzeugen (gleiche url, verschiedene Bereiche).
 */
export interface Entry {
  id: string;
  /** Hauptbereich (frei vergeben, normalisiert): bestimmt die Gruppierung. */
  area: string;
  /**
   * Weitere Bereiche, in denen der Eintrag auch erscheint (ohne den Hauptbereich). Ein Fund,
   * der für zwei Themen taugt, wird nicht zweimal angelegt. Ein Bereichsfilter trifft
   * area = x oder x in also_areas (siehe entryInArea).
   */
  also_areas: string[];
  name: string;
  url: string | null;
  /** Kurzbeschreibung (ein, zwei Sätze); Längeres gehört in notes_md. */
  description: string;
  category: string | null;
  tags: string[];
  /**
   * Die eigenen Worte des Nutzers, warum er den Fund gespeichert hat und was daran wichtig ist
   * (aus dem Dump-Kommentar übernommen); Teil der Volltextsuche. Wird derselbe Fund erneut
   * gespeichert, kommt eine datierte Zeile dazu statt einer Überschreibung. '' = keiner.
   */
  comment: string;
  notes_md: string;
  source_platform: SourcePlatform | null;
  source_media_type: SourceMediaType | null;
  source_author: string | null;
  source_author_handle: string | null;
  source_title: string | null;
  /** ISO-Datum (YYYY-MM-DD), nur wenn die Quelle es nennt. */
  source_published_at: string | null;
  source_duration_seconds: number | null;
  source_word_count: number | null;
  source_page_count: number | null;
  /** Hochgeladene Datei, aus der der Eintrag stammt (dieselbe uploads-Zeile wie beim Dump-Item). */
  upload_id: string | null;
  /** Nur gesetzt, wenn die Query den Embed `upload:uploads(...)` mitselektiert. */
  upload?: Upload | null;
  /** Wann das Item in den Dump kam. */
  captured_at: string;
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht (bleibt in der DB, in der App unsichtbar). null = live. */
  deleted_at: string | null;
}

/**
 * Persistentes Memory für Claude-Agenten: ein Fakt/eine Präferenz pro Eintrag.
 * Source of Truth ist Supabase; scripts/memory/sync-claude-md.mjs rendert alle
 * Einträge nach ~/.claude/globals/larvis-memories.md (Include der globalen
 * CLAUDE.md), damit Agenten sie ohne MCP-Call im Kontext haben.
 */
export interface Memory {
  id: string;
  /** Stabiler kebab-case-Schlüssel, Upsert-Key für save_memory. */
  slug: string;
  title: string;
  content_md: string;
  kind: MemoryKind;
  /** null = global; sonst Projekt-/Workspace-Slug (z. B. 'larvis'). */
  scope: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentTask {
  id: string;
  project_id: string | null;
  title: string;
  prompt_md: string;
  status: AgentTaskStatus;
  result_md: string | null;
  error: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/**
 * Coarse source label: 'larvis' = the app-managed calendar, 'primary' = any other Google
 * calendar, 'subscription' = a read-only ICS subscription (Kalender-Abo, e.g. Outlook).
 */
export type CalendarSource = 'primary' | 'larvis' | 'subscription';

/** Normalized calendar event (provider-agnostic; currently Google). */
export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  location: string | null;
  start: string; // ISO datetime or date
  end: string; // ISO datetime or date
  all_day: boolean;
  html_link: string | null;
  /** Coarse source label ('larvis' = app calendar, 'primary' = any other calendar). */
  calendar: CalendarSource;
  /** Real Google calendar id this event lives on. Used to route edits/deletes to the right calendar. */
  calendar_id: string;
  /** Human name of the source calendar (for display), or null. */
  calendar_name: string | null;
  /** The source calendar's own colour (hex), for display when no project colour applies. */
  color: string | null;
  /** True when the app may patch/delete this event (accessRole owner/writer). */
  editable: boolean;
  /** Larvis project this event belongs to (from extendedProperties), if any. */
  project_id: string | null;
  /** Freeform tags (from extendedProperties), comma-joined on the wire. */
  tags: string[];
  /** Set when the event mirrors a todo (managed automatically). */
  todo_id: string | null;
  /** Google eventType ('default' | 'birthday' | …). Birthdays render with a cake and recur yearly. */
  event_type: string | null;
  /** For one expanded instance of a recurring series, the master event's id — used to edit/delete the whole series. */
  recurring_event_id: string | null;
  /** Larvis-Ort (places.id) aus den extendedProperties, falls zugeordnet. */
  place_id: string | null;
}

/**
 * Ein wiederkehrender Ort (Uni, Büro, Halle …), dem Termine zugeordnet werden.
 * travel_minutes ist die übliche Anfahrtszeit; aliases sind weitere Namen, unter
 * denen der Ort in Freitext-Locations wiedererkannt wird.
 */
export interface Place {
  id: string;
  name: string;
  address: string;
  city: string;
  travel_minutes: number | null;
  notes_md: string;
  aliases: string[];
  created_at: string;
  updated_at: string;
  /** Soft-Delete: gesetzt = gelöscht. null = live. */
  deleted_at: string | null;
}

/**
 * Ein Kalender-Abo, wie App und MCP es sehen: ein fremder Kalender, den Larvis über
 * seinen geheimen ICS-Link nur liest. Der Link selbst verlässt den Server nie, nach
 * außen geht nur `url_hint` (Host plus maskiertes Ende).
 */
export interface CalendarSubscription {
  id: string;
  name: string;
  /**
   * Eigene Anzeigefarbe des Abos (#rrggbb). Gilt nur ohne Projekt; mit Projekt färben sich
   * die Termine (und der Punkt in der Abo-Verwaltung) mit der wirksamen Projektfarbe.
   */
  color: string;
  /**
   * Larvis-Projekt des Abos oder null. Jeder Termin des Abos trägt diese project_id und
   * verhält sich damit wie ein Projekttermin (Projektfarbe, Projektspalte der Tafel, Projekt im Termin).
   */
  project_id: string | null;
  /** Aus = Termine werden nicht geladen, das Abo bleibt bestehen. */
  enabled: boolean;
  /** Host plus maskiertes Ende des Links, z. B. "outlook.office365.com/…f3a9.ics". */
  url_hint: string;
  /** Letzter erfolgreicher Abruf. */
  last_synced_at: string | null;
  /** Fehler des letzten Abrufs; null, wenn er geklappt hat. */
  last_error: string | null;
  created_at: string;
}

// --- Learnweb (Moodle Uni Münster) -------------------------------------------
// Read-only Cache: der Sync spiegelt Kurse/Materialien/Ankündigungen/Termine und
// eLectures nach Supabase, die App liest nur diesen Cache. Transkripte werden
// lokal (faster-whisper) erzeugt und in learnweb_videos abgelegt.

export const LEARNWEB_VIDEO_STATUSES = ['none', 'queued', 'transcribing', 'done', 'failed'] as const;
export type LearnwebVideoStatus = (typeof LEARNWEB_VIDEO_STATUSES)[number];

/** Status-Labels für Badge und MCP-Tool-Beschreibung. */
export const LEARNWEB_VIDEO_STATUS_LABELS: Record<LearnwebVideoStatus, string> = {
  none: 'Kein Transkript',
  queued: 'In Warteschlange',
  transcribing: 'Wird transkribiert…',
  done: 'Transkript',
  failed: 'Fehlgeschlagen',
};

/** Anzeige-Labels je Moodle-Aktivitätstyp (für Icons/Text im Tab). Freitext-Fallback erlaubt. */
export const LEARNWEB_MODTYPE_LABELS: Record<string, string> = {
  resource: 'Datei',
  folder: 'Verzeichnis',
  forum: 'Forum',
  url: 'Link',
  page: 'Seite',
  opencast: 'Video',
  assign: 'Abgabe',
  quiz: 'Test',
  scheduler: 'Sprechstunde',
  label: 'Text',
};

/** Ein Transkript-Segment (Zeitmarke + Text), wie von faster-whisper geliefert. */
export interface LearnwebTranscriptSegment {
  start: number; // Sekunden
  end: number; // Sekunden
  text: string;
}

/** Ein belegter Learnweb-Kurs (Moodle-Kurs). */
export interface LearnwebCourse {
  id: string;
  /** Moodle-Kurs-Id (course/view.php?id=), Upsert-Key. */
  moodle_id: number;
  /** Verknüpftes Larvis-Projekt („Projekt aus Kurs erstellen"). */
  project_id: string | null;
  fullname: string;
  shortname: string;
  url: string;
  startdate: string | null;
  enddate: string | null;
  visible: boolean;
  /** Hash der zuletzt geparsten Kursseite; unverändert = Deep-Sync übersprungen. */
  content_hash: string | null;
  last_synced_at: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Eine Aktivität/ein Material auf einer Kursseite. */
export interface LearnwebItem {
  id: string;
  course_id: string;
  /** Moodle course-module-Id (mod/<typ>/view.php?id=), Upsert-Key. */
  cmid: number;
  section_id: number | null;
  section_name: string;
  subsection_name: string | null;
  /** Moodle-Modultyp: resource, folder, forum, url, opencast, … */
  modtype: string;
  /** Anzeige-Label der Kursseite („Datei", „Verzeichnis"). */
  type_label: string;
  name: string;
  url: string;
  /** Dateigröße wie angezeigt („1,2 MB"), sofern vorhanden. */
  size_text: string | null;
  sort_order: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Eine eLecture (Opencast-Episode oder mp4-Datei) samt lokal erzeugtem Transkript. */
export interface LearnwebVideo {
  id: string;
  course_id: string;
  item_id: string | null;
  /** Opencast-Episode-UUID bzw. 'resource:<cmid>', Upsert-Key. */
  episode_key: string;
  kind: 'opencast' | 'file';
  title: string;
  /** Länge in Sekunden; null = mp4 evtl. noch in Verarbeitung. */
  duration_seconds: number | null;
  recorded_at: string | null;
  /** Learnweb-Seite der Episode (Quelle für frische mp4-URLs). */
  episode_url: string;
  preview_url: string | null;
  sort_order: number;
  transcript_md: string;
  segments: LearnwebTranscriptSegment[];
  status: LearnwebVideoStatus;
  /** Verwendetes Whisper-Modell, z. B. „faster-whisper small". */
  model: string | null;
  transcribed_at: string | null;
  error: string | null;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Ein Beitrag aus dem Ankündigungs-Forum eines Kurses. */
export interface LearnwebAnnouncement {
  id: string;
  course_id: string;
  /** Moodle-Diskussions-Id (discuss.php?d=), Upsert-Key. */
  discussion_id: number;
  subject: string;
  author: string | null;
  posted_at: string | null;
  body_text: string;
  url: string;
  pinned: boolean;
  first_seen_at: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Ein anstehender Termin/eine Abgabe (Moodle calendar action event). */
export interface LearnwebEvent {
  id: string;
  /** Moodle-Event-Id, Upsert-Key. */
  event_id: number;
  course_id: string | null;
  name: string;
  /** Moodle-Modulname (assign, quiz, url, …). */
  modulename: string | null;
  starts_at: string;
  url: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** A project plus its children, for tree rendering. */
export interface ProjectNode extends Project {
  children: ProjectNode[];
}

/** A note plus its child notes, for folder-tree rendering. */
export interface NoteNode extends Note {
  children: NoteNode[];
}

/** Eine Wiki-Seite plus ihre Unterseiten, für den Seitenbaum. */
export interface LearningNode extends Learning {
  children: LearningNode[];
}
