-- Podcasts und Erklärvideos: fertige Folgen (MP3) und Videos (MP4) zum Hören und Ansehen, je
-- einem Projekt zugeordnet. Larvis spielt sie ab, merkt sich den Stand und teilt sie; erzeugt
-- werden sie außerhalb von Larvis (etwa mit dem Claude-Code-Plugin „explainers", siehe README)
-- und kommen über scripts/podcasts/upload.mjs bzw. scripts/videos/upload.mjs herein. Das
-- Paketformat, das beide Skripte erwarten, steht in scripts/README.md.
--
--   podcast_episodes          eine Folge: EINE MP3 mit Kapitelmarken plus ihre Kapitelliste als
--                             Daten. share_video_path ist dieselbe Tonspur als MP4 mit Titelkarte
--                             und laufendem Kapitel, damit sich die Folge als Video verschicken
--                             lässt (Teilen-Knopf im Player); null, solange keine erzeugt ist.
--   podcast_progress          Hörstand je Folge, damit Handy und PC an derselben Stelle
--                             weitermachen.
--   explainer_videos          ein Erklärvideo: EINE MP4 (16:9) plus Vorschaubild und
--                             Kapitelliste. Es teilt seine Datei direkt.
--   explainer_video_progress  Sehstand je Video.
--
-- Folge und Video zum selben Thema tragen denselben Slug und stehen in der App beieinander; sie
-- haben aber eigene Länge, eigene Kapitel und eigenen Fortschritt, deshalb eigene Tabellen statt
-- eines Typ-Felds. Der Upload upsertet auf den Slug: ein zweiter Upload ersetzt den ersten.
--
-- chapters-Form (Sekunden in der fertigen Datei):
--   [ { "id": "einleitung", "title": "Worum es geht", "start": 0, "end": 92.4 }, … ]
-- voices-Form (Folge):   { "A": { "name": "…", "role": "…" }, "B": { "name": "…" } }
-- narrator-Form (Video): { "name": "…" }
--
-- Der Tab „Podcasts" (/podcasts) zeigt Folgen und Videos nach Projekt gruppiert, eine Folge
-- öffnet unter /podcasts/<slug>, ein Video unter /podcasts/<slug>/video; die Projektseite zeigt
-- die Folgen und Videos ihres Teilbaums. Über MCP sind beide nur lesbar (podcast_list,
-- explainer_video_list).
--
-- Dateien liegen in zwei privaten Buckets unter <owner_uid>/<slug>-<hash>.<ext>; jede Fassung hat
-- einen eigenen Pfad (Hash des Inhalts), die App holt sie über signierte URLs. Das Limit je Datei
-- ist 50 MB, wie das globale Limit des Storage-Dienstes (supabase/config.toml setzt
-- file_size_limit = "50MiB" ausdrücklich, deploy/supabase/docker-compose.yml setzt
-- FILE_SIZE_LIMIT, Caddy lässt 60 MB durch), und die Upload-Skripte prüfen es vorab mit MAX_BYTES
-- (scripts/podcasts/upload.mjs, scripts/podcasts/backfill-share-video.mjs, scripts/videos/upload.mjs);
-- ein höheres Limit heißt, alle diese Stellen anzuheben. Die Erzeuger kodieren darunter: eine halbe Stunde MP3 in 64 kbit/s mono wiegt
-- rund 15 MB, 15 Minuten 1080p mit Folienbildern um 400 kbit/s rund 45 MB.

create table if not exists public.podcast_episodes (
  id               uuid primary key default gen_random_uuid(),
  -- Stabiler Schlüssel aus der Quelle; der Upload upsertet darauf.
  slug             text not null unique,
  project_id       uuid references public.projects(id) on delete set null,
  title            text not null,
  -- Kurzzeile unter dem Titel, etwa „Autor & Autorin 2021 · Journal“.
  subtitle         text not null default '',
  description_md   text not null default '',
  audio_path       text,
  share_video_path text,
  duration_s       numeric,
  chapters         jsonb not null default '[]'::jsonb,
  voices           jsonb not null default '{}'::jsonb,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(description_md, ''))
  ) stored
);

create index if not exists podcast_episodes_project_idx
  on public.podcast_episodes (project_id, sort_order) where deleted_at is null;
create index if not exists podcast_episodes_search_idx
  on public.podcast_episodes using gin (search) where deleted_at is null;

-- Ein Nutzer, daher episode_id als Primärschlüssel.
create table if not exists public.podcast_progress (
  episode_id  uuid primary key references public.podcast_episodes(id) on delete cascade,
  position_s  numeric not null default 0,
  completed   boolean not null default false,
  listened_at timestamptz,
  updated_at  timestamptz not null default now()
);

create table if not exists public.explainer_videos (
  id             uuid primary key default gen_random_uuid(),
  -- Stabiler Schlüssel aus der Quelle; derselbe wie bei der Folge zum selben Thema.
  slug           text not null unique,
  project_id     uuid references public.projects(id) on delete set null,
  title          text not null,
  subtitle       text not null default '',
  description_md text not null default '',
  video_path     text,
  poster_path    text,
  duration_s     numeric,
  chapters       jsonb not null default '[]'::jsonb,
  narrator       jsonb not null default '{}'::jsonb,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  search tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(subtitle, '') || ' ' || coalesce(description_md, ''))
  ) stored
);

create index if not exists explainer_videos_project_idx
  on public.explainer_videos (project_id, sort_order) where deleted_at is null;
create index if not exists explainer_videos_search_idx
  on public.explainer_videos using gin (search) where deleted_at is null;

-- Ein Nutzer, daher video_id als Primärschlüssel.
create table if not exists public.explainer_video_progress (
  video_id   uuid primary key references public.explainer_videos(id) on delete cascade,
  position_s numeric not null default 0,
  completed  boolean not null default false,
  watched_at timestamptz,
  updated_at timestamptz not null default now()
);

-- updated_at-Trigger, Row Level Security („owner full access"), Realtime: dieselben Muster wie
-- in der Basis-Migration.
do $$
declare t text;
begin
  foreach t in array array['podcast_episodes', 'podcast_progress', 'explainer_videos', 'explainer_video_progress'] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "owner full access" on public.%I', t);
    execute format(
      'create policy "owner full access" on public.%I for all to authenticated using (public.is_owner()) with check (public.is_owner())', t);
    execute format('alter table public.%I replica identity full', t);
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Buckets: privat, 50 MB je Datei. podcast-audio nimmt die MP3 und das Teil-Video (MP4),
-- explainer-video das Video und sein Vorschaubild.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('podcast-audio', 'podcast-audio', false, 52428800, array['audio/mpeg', 'audio/mp3', 'video/mp4']),
  ('explainer-video', 'explainer-video', false, 52428800, array['video/mp4', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Zugriff nur auf den eigenen Ordner <auth.uid()>/…, wie bei den Buckets der Basis-Migration.
do $$
declare
  b text;
  p text;
  own text;
begin
  foreach b in array array['podcast-audio', 'explainer-video'] loop
    p := replace(b, '-', '_') || '_owner';
    own := format('bucket_id = %L and (storage.foldername(name))[1] = auth.uid()::text', b);
    execute format('drop policy if exists %I on storage.objects', p || '_read');
    execute format('drop policy if exists %I on storage.objects', p || '_insert');
    execute format('drop policy if exists %I on storage.objects', p || '_update');
    execute format('drop policy if exists %I on storage.objects', p || '_delete');
    execute format('create policy %I on storage.objects for select to authenticated using (%s)', p || '_read', own);
    execute format('create policy %I on storage.objects for insert to authenticated with check (%s)', p || '_insert', own);
    execute format('create policy %I on storage.objects for update to authenticated using (%s) with check (%s)', p || '_update', own, own);
    execute format('create policy %I on storage.objects for delete to authenticated using (%s)', p || '_delete', own);
  end loop;
end $$;
