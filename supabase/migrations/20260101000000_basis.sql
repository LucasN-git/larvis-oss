-- Larvis: das vollständige Datenbankschema in einer Migration.
--
-- Larvis ist eine Ein-Nutzer-App. Das älteste Konto in auth.users ist der Owner
-- (public.is_owner()); jede Tabelle hat Row Level Security, und nur der Owner sieht und
-- ändert Daten. Server-Teile (API, MCP-Server, Skripte) arbeiten mit dem Service-Role-Key
-- und umgehen RLS.
--
-- Gemeinsame Muster:
--   deleted_at    Soft-Delete: gesetzt = gelöscht, die App zeigt die Zeile nirgends mehr,
--                 sie bleibt aber wiederherstellbar.
--   updated_at    pflegt der Trigger set_updated_at.
--   search        generierte tsvector-Spalte (Konfiguration 'simple') für die Volltextsuche;
--                 die Live-Indizes gelten nur für nicht gelöschte Zeilen.
--   Realtime      Tabellen, die die App live beobachtet, stehen in der Publication
--                 supabase_realtime und haben replica identity full.

-- ---------------------------------------------------------------------------
-- Erweiterungen und Hilfsfunktionen
-- ---------------------------------------------------------------------------

-- pg_cron ruft jede Minute den Benachrichtigungs-Tick der App auf, pg_net schickt den Request.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Owner = das älteste Konto. Security definer, damit die Funktion auth.users lesen darf.
create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and auth.uid() = (select id from auth.users order by created_at asc limit 1)
$$;

create function public.immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$ select pg_catalog.array_to_string(arr, sep) $$;

comment on function public.immutable_array_to_string(text[], text) is
  'array_to_string als IMMUTABLE, damit tags in generierte tsvector-Spalten eingehen können.';

revoke execute on function public.immutable_array_to_string(text[], text) from public, anon;
grant execute on function public.immutable_array_to_string(text[], text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Projekte, ToDos, Notizen, Dinge
-- ---------------------------------------------------------------------------

-- Projekte bilden einen Baum (parent_id). Nur ein Hauptprojekt trägt eine Farbe aus der
-- Palette, Unterprojekte erben sie. local_path ist der Ordner des Projekts auf dem eigenen
-- Rechner (für „Ordner öffnen"-Links).
create table public.projects (
  id             uuid primary key default gen_random_uuid(),
  parent_id      uuid references public.projects (id) on delete set null,
  name           text not null,
  slug           text not null unique,
  description_md text not null default '',
  status         text not null default 'active'
                   constraint projects_status_check check (status in ('active', 'paused', 'done', 'archived')),
  color          text,
  icon           text,
  local_path     text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index projects_parent_id_idx on public.projects (parent_id);
create index projects_status_idx on public.projects (status);
create index projects_live_status_sort_idx on public.projects (status, sort_order) where deleted_at is null;

-- area: 'project' (an einem Projekt) oder 'personal'. backlog parkt ein ToDo außerhalb von
-- „Heute"; gcal_event_id verknüpft es mit seinem Spiegel im Google-Kalender.
create table public.todos (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects (id) on delete set null,
  area          text not null default 'project'
                  constraint todos_area_check check (area in ('project', 'personal')),
  title         text not null,
  body_md       text not null default '',
  status        text not null default 'todo'
                  constraint todos_status_check check (status in ('todo', 'doing', 'done')),
  priority      smallint not null default 0
                  constraint todos_priority_check check (priority between 0 and 3),
  backlog       boolean not null default false,
  due_at        timestamptz,
  completed_at  timestamptz,
  tags          text[] not null default '{}',
  gcal_event_id text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index todos_project_id_idx on public.todos (project_id);
create index todos_area_idx on public.todos (area);
create index todos_status_idx on public.todos (status);
create index todos_due_at_idx on public.todos (due_at);
create index todos_backlog_idx on public.todos (backlog);
create index todos_live_project_idx on public.todos (project_id) where deleted_at is null;
create index todos_live_status_due_idx on public.todos (status, due_at) where deleted_at is null;

-- Notizen: Ordnerbaum je Projekt (parent_id), Archiv-Stufe (archived_at), optional ein
-- Emoji-Icon und ein Themen-Graph (jsonb {nodes, edges, groups}). Versionierung: alle
-- Versionen einer Notiz teilen series_id und zählen version_no hoch; eine ältere Fassung ist
-- mit superseded_at eingefroren, je Serie ist genau eine Version aktuell.
create table public.notes (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid references public.projects (id) on delete set null,
  parent_id           uuid references public.notes (id) on delete set null,
  area                text not null default 'project'
                        constraint notes_area_check check (area in ('project', 'personal')),
  title               text not null default '',
  body_md             text not null default '',
  tags                text[] not null default '{}',
  sort_order          integer not null default 0,
  icon                text,
  graph               jsonb
                        constraint notes_graph_is_object check (graph is null or jsonb_typeof(graph) = 'object'),
  series_id           uuid not null default gen_random_uuid(),
  version_no          integer not null default 1
                        constraint notes_version_no_positive check (version_no >= 1),
  previous_version_id uuid references public.notes (id) on delete set null,
  superseded_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  deleted_at          timestamptz,
  search              tsvector generated always as (
                        to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body_md, ''))
                      ) stored,
  constraint notes_series_version_key unique (series_id, version_no)
);
create index notes_project_id_idx on public.notes (project_id);
create index notes_parent_id_idx on public.notes (parent_id);
create index notes_area_idx on public.notes (area);
create index notes_archived_idx on public.notes (archived_at) where deleted_at is null and archived_at is not null;
create index notes_live_tree_idx on public.notes (project_id, parent_id) where deleted_at is null and archived_at is null;
create index notes_search_live_idx on public.notes using gin (search) where deleted_at is null;
create index notes_previous_version_idx on public.notes (previous_version_id) where previous_version_id is not null;
create unique index notes_one_current_per_series on public.notes (series_id) where superseded_at is null;

-- Neue Version einer Notiz aus der aktuellen Version ihrer Serie: kopiert Inhalt (ohne
-- Anhänge), friert alle älteren Versionen ein und hängt die Unternotizen an die neue Version.
-- Optionale Parameter überschreiben Titel, Inhalt, Tags, Icon oder Graph der Kopie.
create function public.create_note_version(
  p_id uuid,
  p_title text default null,
  p_body_md text default null,
  p_tags text[] default null,
  p_icon text default null,
  p_graph jsonb default null
)
returns public.notes
language plpgsql
as $$
declare
  src public.notes;
  latest public.notes;
  next_no integer;
  created public.notes;
begin
  select * into src from public.notes where id = p_id for update;
  if not found then
    raise exception 'Notiz % nicht gefunden', p_id;
  end if;
  if src.deleted_at is not null then
    raise exception 'Notiz % ist gelöscht; erst mit restore_note zurückholen.', p_id;
  end if;
  select * into latest from public.notes
    where series_id = src.series_id and deleted_at is null
    order by version_no desc limit 1 for update;
  if latest.id <> src.id then
    raise exception 'Notiz % ist Version % und nicht die aktuelle; aktuelle Version ist % (id %). Neue Version nur aus der aktuellen anlegen.',
      src.id, src.version_no, latest.version_no, latest.id;
  end if;
  select coalesce(max(version_no), 0) + 1 into next_no from public.notes where series_id = src.series_id;
  update public.notes set superseded_at = now()
    where series_id = src.series_id and superseded_at is null;
  insert into public.notes
    (series_id, version_no, previous_version_id, title, body_md, tags, project_id, parent_id, area, icon, graph, sort_order)
  values
    (src.series_id, next_no, src.id,
     coalesce(nullif(btrim(p_title), ''), src.title),
     coalesce(p_body_md, src.body_md),
     coalesce(p_tags, src.tags),
     src.project_id, src.parent_id, src.area,
     coalesce(p_icon, src.icon),
     coalesce(p_graph, src.graph),
     src.sort_order)
  returning * into created;
  update public.notes set parent_id = created.id
    where deleted_at is null
      and parent_id in (select id from public.notes where series_id = src.series_id and id <> created.id);
  return created;
end;
$$;

-- Dateien und eingefügte Bilder einer Notiz; die Binärdaten liegen im Bucket note-files.
create table public.note_attachments (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes (id) on delete cascade,
  storage_path text not null,
  filename     text not null default '',
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  kind         text not null default 'file'
                 constraint note_attachments_kind_check check (kind in ('image', 'file')),
  inline       boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index note_attachments_note_id_idx on public.note_attachments (note_id);

-- Dinge: wo ein Gegenstand liegt.
create table public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  location   text not null default '',
  category   text,
  notes_md   text not null default '',
  area       text not null default 'personal'
               constraint items_area_check check (area in ('project', 'personal')),
  project_id uuid references public.projects (id) on delete set null,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search     tsvector generated always as (
               to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(location, '') || ' ' || coalesce(notes_md, ''))
             ) stored
);
create index items_area_idx on public.items (area);
create index items_live_area_name_idx on public.items (area, name) where deleted_at is null;
create index items_search_live_idx on public.items using gin (search) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Dump, Einträge (Tab „Inbox") und Wiki (Tab „Learnings")
-- ---------------------------------------------------------------------------

-- Hochgeladene Dateien im Bucket uploads; Dump-Item und daraus entstandener Eintrag zeigen
-- auf dieselbe Zeile.
create table public.uploads (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null,
  filename     text not null default '',
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  created_at   timestamptz not null default now()
);
create unique index uploads_storage_path_idx on public.uploads (storage_path);

-- Der Dump: roher Eingangsstapel. note ist der eigene Kommentar beim Speichern; scanned_at und
-- scan_note setzt Claude beim Ansehen, processed beim Einordnen.
create table public.inbox (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,
  note         text,
  upload_id    uuid references public.uploads (id) on delete set null,
  processed    boolean not null default false,
  processed_at timestamptz,
  scanned_at   timestamptz,
  scan_note    text,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index inbox_open_idx on public.inbox (processed, created_at);
create index inbox_live_open_idx on public.inbox (processed, created_at) where deleted_at is null;
create index inbox_unscanned_idx on public.inbox (created_at desc)
  where deleted_at is null and processed = false and scanned_at is null;
create index inbox_live_upload_idx on public.inbox (upload_id) where deleted_at is null and upload_id is not null;

-- Bereiche (area) von Einträgen und Wiki-Seiten sind frei vergebener Text, gespeichert in
-- normalisierter Form: nicht leer, höchstens 40 Zeichen, klein geschrieben, ohne Rand-
-- Leerzeichen. Vordefinierte Bereiche gibt es nicht; die View area_usage zählt die vorhandenen.

-- Einträge: einsortierte fremde Funde. Ein Fund für zwei Themen hat einen Hauptbereich (area)
-- und weitere in also_areas. comment hält die eigenen Worte, warum er gespeichert wurde;
-- source_* beschreiben die Quelle. Die Suche gewichtet Kommentar vor Name und Tags vor
-- Beschreibung und Quelle vor Notizen.
create table public.entries (
  id                      uuid primary key default gen_random_uuid(),
  area                    text not null,
  also_areas              text[] not null default '{}',
  name                    text not null,
  url                     text,
  description             text not null default '',
  category                text,
  tags                    text[] not null default '{}',
  comment                 text not null default '',
  notes_md                text not null default '',
  source_platform         text,
  source_media_type       text,
  source_author           text,
  source_author_handle    text,
  source_title            text,
  source_published_at     date,
  source_duration_seconds integer,
  source_word_count       integer,
  source_page_count       integer,
  upload_id               uuid references public.uploads (id) on delete set null,
  captured_at             timestamptz not null default now(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  search                  tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(comment, '')), 'A')
    || setweight(to_tsvector('simple', coalesce(name, '')), 'B')
    || setweight(to_tsvector('simple', public.immutable_array_to_string(tags, ' ')), 'B')
    || setweight(to_tsvector('simple', coalesce(description, '') || ' ' || coalesce(category, '') || ' '
         || coalesce(source_author, '') || ' ' || coalesce(source_author_handle, '') || ' '
         || coalesce(source_title, '')), 'C')
    || setweight(to_tsvector('simple', coalesce(notes_md, '')), 'D')
  ) stored,
  constraint entries_area_check check (
    area <> '' and char_length(area) <= 40 and area = lower(area) and area = btrim(area)
  ),
  constraint entries_also_areas_check check (not (area = any (also_areas))),
  constraint entries_source_platform_check check (
    source_platform is null or source_platform in
      ('instagram', 'youtube', 'tiktok', 'x', 'linkedin', 'web', 'podcast', 'pdf', 'upload', 'other')
  ),
  constraint entries_source_media_type_check check (
    source_media_type is null or source_media_type in ('video', 'image', 'carousel', 'text', 'audio', 'document')
  )
);
create index entries_live_area_created_idx on public.entries (area, created_at) where deleted_at is null;
create index entries_live_area_category_idx on public.entries (area, category) where deleted_at is null;
create index entries_live_also_areas_idx on public.entries using gin (also_areas) where deleted_at is null;
create index entries_live_url_idx on public.entries (url) where deleted_at is null;
create index entries_live_upload_idx on public.entries (upload_id) where deleted_at is null and upload_id is not null;
create index entries_search_live_idx on public.entries using gin (search) where deleted_at is null;

-- Wiki-Seiten: Seitenbaum je Bereich (parent_id); slug ist die feste Adresse
-- (/learnings/<slug>), der Upsert-Schlüssel und das Ziel interner Links.
create table public.learnings (
  id         uuid primary key default gen_random_uuid(),
  area       text not null,
  parent_id  uuid references public.learnings (id) on delete set null,
  slug       text not null unique
               constraint learnings_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title      text not null,
  summary    text,
  body_md    text not null default '',
  tags       text[] not null default '{}',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  search     tsvector generated always as (
               to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(body_md, ''))
             ) stored,
  constraint learnings_area_check check (
    area <> '' and char_length(area) <= 40 and area = lower(area) and area = btrim(area)
  )
);
create index learnings_live_tree_idx on public.learnings (area, parent_id, sort_order) where deleted_at is null;
create index learnings_search_live_idx on public.learnings using gin (search) where deleted_at is null;

-- Belege einer Wiki-Seite: genau ein Eintrag oder eine Notiz je Zeile, mit Rolle und einem
-- Satz, was die Quelle zeigt. Dieselbe Quelle hängt an einer Seite höchstens einmal.
create table public.learning_sources (
  id          uuid primary key default gen_random_uuid(),
  learning_id uuid not null references public.learnings (id) on delete cascade,
  entry_id    uuid references public.entries (id) on delete cascade,
  note_id     uuid references public.notes (id) on delete cascade,
  role        text not null default 'beleg'
                constraint learning_sources_role_check check (role in ('beleg', 'beispiel', 'gegenbeispiel', 'erfahrung')),
  comment     text not null default '',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  constraint learning_sources_check check ((entry_id is null) <> (note_id is null)),
  constraint learning_sources_entry_uniq unique (learning_id, entry_id),
  constraint learning_sources_note_uniq unique (learning_id, note_id)
);
create index learning_sources_entry_idx on public.learning_sources (entry_id);
create index learning_sources_note_idx on public.learning_sources (note_id);

-- Grafiken und Dateien einer Wiki-Seite; die Binärdaten liegen im Bucket learning-files.
create table public.learning_attachments (
  id           uuid primary key default gen_random_uuid(),
  learning_id  uuid not null references public.learnings (id) on delete cascade,
  storage_path text not null,
  filename     text not null default '',
  mime_type    text not null default 'application/octet-stream',
  size_bytes   bigint not null default 0,
  kind         text not null default 'file'
                 constraint learning_attachments_kind_check check (kind in ('image', 'file')),
  inline       boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index learning_attachments_learning_id_idx on public.learning_attachments (learning_id);

-- Die vorhandenen Bereiche mit der Zahl der lebenden Zeilen, getrennt nach Quelle
-- ('entries' zählt Haupt- und weitere Bereiche, 'learnings' die Seiten). security_invoker,
-- damit die RLS der Tabellen gilt.
create view public.area_usage with (security_invoker = true) as
  select 'entries'::text as source, a.area, count(*)::integer as count
    from public.entries e
    cross join lateral unnest(array_prepend(e.area, e.also_areas)) as a(area)
   where e.deleted_at is null
   group by a.area
  union all
  select 'learnings'::text, l.area, count(*)::integer
    from public.learnings l
   where l.deleted_at is null
   group by l.area;

-- ---------------------------------------------------------------------------
-- Memories, Briefings, Kontakte, Orte, Agent-Queue
-- ---------------------------------------------------------------------------

-- Dauerhafte Fakten und Vereinbarungen für Agenten; slug ist der Upsert-Schlüssel, scope
-- null = global.
create table public.memories (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  title      text not null,
  content_md text not null default '',
  kind       text not null default 'user'
               constraint memories_kind_check check (kind in ('user', 'feedback', 'project', 'reference', 'skill')),
  scope      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_kind_idx on public.memories (kind);

-- Tages-Briefing, eine Zeile je lokalem Datum; read_at = abgehakt.
create table public.briefings (
  id         uuid primary key default gen_random_uuid(),
  date       date not null unique,
  content_md text not null,
  model      text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

-- Adressbuch: phones, emails, addresses als [{label, value}], links als [{label, url}];
-- business trennt berufliche von privaten Kontakten. Bei unbekanntem Geburtsjahr steht das
-- Platzhalterjahr 1604 im Datum und birthday_year_known ist false.
create table public.contacts (
  id                  uuid primary key default gen_random_uuid(),
  first_name          text not null default '',
  last_name           text not null default '',
  nickname            text,
  birthday            date,
  birthday_year_known boolean not null default true,
  business            boolean not null default false,
  phones              jsonb not null default '[]',
  emails              jsonb not null default '[]',
  addresses           jsonb not null default '[]',
  company             text,
  position            text,
  current_status      text not null default '',
  linkedin_url        text,
  links               jsonb not null default '[]',
  tags                text[] not null default '{}',
  notes_md            text not null default '',
  source              text not null default 'manual'
                        constraint contacts_source_check check (source in ('manual', 'vcard', 'linkedin', 'whatsapp')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index contacts_name_idx on public.contacts (first_name, last_name);
create unique index contacts_linkedin_url_key on public.contacts (linkedin_url) where linkedin_url is not null;

-- Orte für Termine: Name (unter lebenden Orten eindeutig, ohne Groß-/Kleinschreibung),
-- Aliase zum Wiedererkennen, travel_minutes = Auto-Fahrzeit ab dem Heimatort.
create table public.places (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  address        text not null default '',
  city           text not null default '',
  travel_minutes integer
                   constraint places_travel_minutes_check check (travel_minutes is null or travel_minutes >= 0),
  notes_md       text not null default '',
  aliases        text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create unique index places_name_live_key on public.places (lower(name)) where deleted_at is null;

-- Aufgaben, die ein lokaler Runner headless mit Claude abarbeitet.
create table public.agent_tasks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete set null,
  title       text not null default '',
  prompt_md   text not null,
  status      text not null default 'queued'
                constraint agent_tasks_status_check check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  result_md   text,
  error       text,
  model       text,
  created_by  text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index agent_tasks_project_id_idx on public.agent_tasks (project_id);
create index agent_tasks_status_idx on public.agent_tasks (status);

-- ---------------------------------------------------------------------------
-- Kalender
-- ---------------------------------------------------------------------------

-- Das verbundene Google-Konto samt Tokens und der Id des app-eigenen Kalenders „Larvis".
-- RLS ohne Policy: nur der Server (Service-Role) liest die Tokens.
create table public.calendar_accounts (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null default 'google',
  google_email       text,
  refresh_token      text,
  access_token       text,
  expiry             timestamptz,
  scopes             text,
  larvis_calendar_id text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Kalender-Abos: fremde Kalender per geheimem ICS-Link, nur lesend. RLS ohne Policy: der
-- Link verlässt den Server nie, die App sieht die Abos nur über die API.
create table public.calendar_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  url            text not null,
  color          text not null default '#2f6fed'
                   constraint calendar_subscriptions_color_hex check (color ~* '^#[0-9a-f]{6}$'),
  project_id     uuid references public.projects (id) on delete set null,
  enabled        boolean not null default true,
  last_synced_at timestamptz,
  last_error     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index calendar_subscriptions_live_idx on public.calendar_subscriptions (created_at) where deleted_at is null;
create index calendar_subscriptions_project_idx on public.calendar_subscriptions (project_id) where project_id is not null;

-- ---------------------------------------------------------------------------
-- Benachrichtigungen
-- ---------------------------------------------------------------------------

-- Eigene Erinnerungen je Termin (kind 'event') oder ToDo (kind 'todo'); der Minuten-Tick
-- verschickt fällige (notify_at erreicht, sent_at leer).
create table public.reminders (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null
                constraint reminders_kind_check check (kind in ('event', 'todo')),
  event_id    text,
  calendar_id text,
  todo_id     uuid references public.todos (id) on delete cascade,
  notify_at   timestamptz,
  custom      boolean not null default true,
  title       text,
  start_at    timestamptz,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint reminders_target_ck check (
    (kind = 'event' and event_id is not null and todo_id is null)
    or (kind = 'todo' and todo_id is not null)
  )
);
create index reminders_due_idx on public.reminders (notify_at) where sent_at is null and notify_at is not null;
create unique index reminders_event_uidx on public.reminders (event_id, calendar_id) where kind = 'event';
create unique index reminders_todo_uidx on public.reminders (todo_id) where kind = 'todo';

comment on column public.reminders.custom is
  'Immer true: jede Zeile ist eine Einzel-Einstellung des Nutzers. Automatische Versände stehen in notification_log.';

-- Web-Push-Abos der Geräte.
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Die Einstellungen der Benachrichtigungen, genau eine Zeile (id = 1).
create table public.notification_settings (
  id         smallint primary key default 1
               constraint notification_settings_id_check check (id = 1),
  prefs      jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Was verschickt wurde; key macht jeden Versand eindeutig (kein Doppelversand). Die App
-- liest nur, geschrieben wird vom Server.
create table public.notification_log (
  key      text primary key,
  category text not null
             constraint notification_log_category_check check (
               category in ('birthdays', 'events', 'todos', 'learnweb', 'digest', 'reminder', 'test')
             ),
  title    text not null default '',
  body     text not null default '',
  sent_at  timestamptz not null default now()
);
create index notification_log_sent_idx on public.notification_log (sent_at desc);

-- ---------------------------------------------------------------------------
-- Optionales Modul Learnweb (Moodle der Uni Münster): Lese-Cache, gefüllt vom Sync
-- ---------------------------------------------------------------------------

create table public.learnweb_courses (
  id             uuid primary key default gen_random_uuid(),
  moodle_id      bigint not null unique,
  project_id     uuid references public.projects (id) on delete set null,
  fullname       text not null,
  shortname      text not null default '',
  url            text not null,
  startdate      timestamptz,
  enddate        timestamptz,
  visible        boolean not null default true,
  content_hash   text,
  last_synced_at timestamptz,
  first_seen_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index learnweb_courses_project_id_idx on public.learnweb_courses (project_id);

create table public.learnweb_items (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid not null references public.learnweb_courses (id) on delete cascade,
  cmid            bigint not null unique,
  section_id      bigint,
  section_name    text not null default '',
  subsection_name text,
  modtype         text not null default '',
  type_label      text not null default '',
  name            text not null,
  url             text not null,
  size_text       text,
  sort_order      integer not null default 0,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index learnweb_items_course_idx on public.learnweb_items (course_id) where deleted_at is null;

-- Vorlesungsvideos samt lokal erzeugtem Transkript; status ist die Transkriptions-Warteschlange.
create table public.learnweb_videos (
  id               uuid primary key default gen_random_uuid(),
  course_id        uuid not null references public.learnweb_courses (id) on delete cascade,
  item_id          uuid references public.learnweb_items (id) on delete set null,
  episode_key      text not null unique,
  kind             text not null default 'opencast'
                     constraint learnweb_videos_kind_check check (kind in ('opencast', 'file')),
  title            text not null,
  duration_seconds numeric,
  recorded_at      date,
  episode_url      text not null,
  preview_url      text,
  sort_order       integer not null default 0,
  transcript_md    text not null default '',
  segments         jsonb not null default '[]',
  status           text not null default 'none'
                     constraint learnweb_videos_status_check check (status in ('none', 'queued', 'transcribing', 'done', 'failed')),
  model            text,
  transcribed_at   timestamptz,
  error            text,
  first_seen_at    timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  search           tsvector generated always as (
                     to_tsvector('simple', coalesce(title, '') || ' ' || left(coalesce(transcript_md, ''), 500000))
                   ) stored
);
create index learnweb_videos_course_idx on public.learnweb_videos (course_id) where deleted_at is null;
create index learnweb_videos_queue_idx on public.learnweb_videos (status)
  where deleted_at is null and status in ('queued', 'transcribing');
create index learnweb_videos_search_idx on public.learnweb_videos using gin (search);

create table public.learnweb_announcements (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references public.learnweb_courses (id) on delete cascade,
  discussion_id bigint not null unique,
  subject       text not null,
  author        text,
  posted_at     timestamptz,
  body_text     text not null default '',
  url           text not null,
  pinned        boolean not null default false,
  first_seen_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  search        tsvector generated always as (
                  to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body_text, ''))
                ) stored
);
create index learnweb_announcements_course_idx on public.learnweb_announcements (course_id) where deleted_at is null;
create index learnweb_announcements_search_idx on public.learnweb_announcements using gin (search);

create table public.learnweb_events (
  id         uuid primary key default gen_random_uuid(),
  event_id   bigint not null unique,
  course_id  uuid references public.learnweb_courses (id) on delete set null,
  name       text not null,
  modulename text,
  starts_at  timestamptz not null,
  url        text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index learnweb_events_starts_idx on public.learnweb_events (starts_at) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- updated_at-Trigger, Row Level Security, Realtime
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'todos', 'notes', 'items', 'entries', 'learnings', 'memories', 'contacts', 'places',
    'calendar_accounts', 'calendar_subscriptions', 'reminders', 'notification_settings',
    'learnweb_courses', 'learnweb_items', 'learnweb_videos', 'learnweb_announcements', 'learnweb_events'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Jede Tabelle hat RLS. Die meisten tragen die eine Policy „owner full access"; ohne Policy
-- (nur Service-Role) bleiben calendar_accounts und calendar_subscriptions, notification_log
-- darf der Owner nur lesen.
do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'todos', 'notes', 'note_attachments', 'items', 'uploads', 'inbox', 'entries',
    'learnings', 'learning_sources', 'learning_attachments', 'memories', 'briefings', 'contacts',
    'places', 'agent_tasks', 'calendar_accounts', 'calendar_subscriptions', 'reminders',
    'push_subscriptions', 'notification_settings', 'notification_log',
    'learnweb_courses', 'learnweb_items', 'learnweb_videos', 'learnweb_announcements', 'learnweb_events'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;

  foreach t in array array[
    'projects', 'todos', 'notes', 'note_attachments', 'items', 'uploads', 'inbox', 'entries',
    'learnings', 'learning_sources', 'learning_attachments', 'memories', 'briefings', 'contacts',
    'places', 'agent_tasks', 'reminders', 'push_subscriptions', 'notification_settings',
    'learnweb_courses', 'learnweb_items', 'learnweb_videos', 'learnweb_announcements', 'learnweb_events'
  ] loop
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
  end loop;
end $$;

create policy "owner read" on public.notification_log
  for select to authenticated using (public.is_owner());

-- Tabellen, die die App live beobachtet.
do $$
declare t text;
begin
  foreach t in array array[
    'projects', 'todos', 'notes', 'note_attachments', 'items', 'inbox', 'entries', 'learnings',
    'learning_sources', 'learning_attachments', 'memories', 'briefings', 'contacts', 'places',
    'agent_tasks', 'reminders',
    'learnweb_courses', 'learnweb_items', 'learnweb_videos', 'learnweb_announcements', 'learnweb_events'
  ] loop
    execute format('alter table public.%I replica identity full', t);
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Storage: Buckets und Policies
-- ---------------------------------------------------------------------------

-- Alle Buckets außer avatars sind privat; Objekte liegen unter <auth.uid()>/…, und jeder
-- Zugriff ist auf den eigenen Ordner beschränkt. Profilbilder sind öffentlich lesbar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 2097152, array['image/webp', 'image/jpeg', 'image/png']),
  ('note-files', 'note-files', false, 26214400, null),
  ('learning-files', 'learning-files', false, 26214400, null),
  ('uploads', 'uploads', false, 52428800, null);

create policy "avatars_public_read" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars_own_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

do $$
declare
  b text;
  p text;
  own text;
begin
  foreach b in array array['note-files', 'learning-files', 'uploads'] loop
    p := replace(b, '-', '_') || '_owner';
    own := format('bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text', b);
    execute format('create policy %I on storage.objects for select to authenticated using (%s)', p || '_read', own);
    execute format('create policy %I on storage.objects for insert to authenticated with check (%s)', p || '_insert', own);
    execute format('create policy %I on storage.objects for update to authenticated using (%s) with check (%s)', p || '_update', own, own);
    execute format('create policy %I on storage.objects for delete to authenticated using (%s)', p || '_delete', own);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Minuten-Cron für Benachrichtigungen
-- ---------------------------------------------------------------------------

-- pg_cron ruft jede Minute POST <reminder_tick_url> mit dem Bearer reminder_cron_secret auf;
-- der Endpoint prüft den Bearer über verify_cron_secret gegen dasselbe Vault-Secret. Die URL
-- ist ein Platzhalter und wird nach dem Einrichten per vault.update_secret auf die eigene
-- Domain gestellt (siehe deploy/README.md); das Secret entsteht zufällig in der Datenbank.
create function public.verify_cron_secret(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(candidate, '') <> ''
     and exists (
       select 1 from vault.decrypted_secrets
       where name = 'reminder_cron_secret' and decrypted_secret = candidate
     );
$$;

revoke execute on function public.verify_cron_secret(text) from public, anon, authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reminder_tick_url') then
    perform vault.create_secret(
      'https://larvis.example.com/api/notifications/tick',
      'reminder_tick_url',
      'URL des Minuten-Ticks (api/notifications/tick)'
    );
  end if;
  if not exists (select 1 from vault.secrets where name = 'reminder_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'reminder_cron_secret',
      'Bearer des Minuten-Crons, geprüft von verify_cron_secret'
    );
  end if;
end $$;

-- Der HTTP-Timeout von 55 s lässt auch einem Tick mit Kalenderabrufen Zeit für seine Antwort.
select cron.schedule(
  'larvis-reminders',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_tick_url'),
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  );
  $job$
);

-- ---------------------------------------------------------------------------
-- Access-Token-Hook für den Remote-MCP-Endpunkt
-- ---------------------------------------------------------------------------

-- Für Tokens des OAuth-Servers (Claim client_id) setzt der Hook die Audience auf die URL des
-- MCP-Endpunkts, damit der Endpunkt sie prüfen kann (MCP_RESOURCE_URL). Gewöhnliche
-- App-Sitzungen bleiben unverändert. GoTrue ruft ihn nur auf, wenn der Hook im Auth-Dienst
-- eingeschaltet ist (deploy/supabase/docker-compose.yml). Die URL ist ein Platzhalter und
-- muss genau MCP_RESOURCE_URL entsprechen: vor dem Einspielen anpassen oder die Funktion
-- danach mit der richtigen URL neu anlegen.
create function public.mcp_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event->'claims';
begin
  if claims ? 'client_id' then
    claims := jsonb_set(claims, '{aud}', to_jsonb('https://larvis.example.com/api/mcp'::text));
    event := jsonb_set(event, '{claims}', claims);
  end if;
  return event;
end;
$$;

grant execute on function public.mcp_access_token_hook to supabase_auth_admin;
revoke execute on function public.mcp_access_token_hook from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Startbestand
-- ---------------------------------------------------------------------------

-- „Persönlich" nimmt alle Notizen und ToDos ohne eigenes Projekt auf und steht in der
-- Projektliste vorn.
insert into public.projects (name, slug, color, description_md, sort_order)
values ('Persönlich', 'persoenlich', '#8B5CF6', 'Allgemeines und Privates — alles ohne eigenes Projekt.', -1);
