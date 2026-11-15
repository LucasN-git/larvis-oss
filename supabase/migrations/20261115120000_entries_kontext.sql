-- Kontext eines Eintrags und die Liste „Machen".
--
--   entries.project_id  optionaler Kontext des Eintrags: das Projekt, für das der Fund
--                       gespeichert wurde. Kontext ist immer ein Hauptprojekt
--                       (projects.parent_id is null). Ein Unterprojekt ist kein Kontext; der
--                       Trigger entries_project_top_level weist es bei jedem Schreibweg ab (ein
--                       CHECK kann keine andere Tabelle lesen).
--                       Wird ein Projekt endgültig gelöscht, verliert der Eintrag den Kontext (on
--                       delete set null). Beim Soft-Delete bleibt die Zuordnung stehen; Web-App
--                       und MCP behandeln einen Kontext, dessen Projekt gelöscht ist, wie keinen.
--                       Wird ein Hauptprojekt unter ein anderes gehängt, wandern seine Einträge
--                       zum neuen Hauptprojekt darüber (Trigger projects_entries_kontext_root),
--                       damit kein Eintrag auf ein Unterprojekt zeigt.
--   entries.done_at     abgehakt („erledigt"): gesetzt = der Eintrag ist umgesetzt und steht
--                       nicht mehr in „Machen"; in der Inbox bleibt er sichtbar. null = offen.
--
-- „Machen" (Tab /machen) sind die lebenden, nicht abgehakten Einträge mit Tag nachmachen oder
-- umsetzen, gruppiert nach Kontext; Einträge ohne Kontext bilden eine eigene Gruppe „Ohne
-- Kontext". Der Teilindex entries_project_open_idx trägt die Abfrage nach Kontext über lebende,
-- offene Einträge.
--
-- Das Suchdokument (entries.search) nimmt den Kontext nicht auf: er ist ein Verweis, kein Text,
-- und eine generierte Spalte kann keine andere Tabelle lesen. Gefiltert wird er strukturiert über
-- die Spalte.

alter table public.entries
  add column if not exists project_id uuid references public.projects (id) on delete set null,
  add column if not exists done_at timestamptz;

create index if not exists entries_project_open_idx
  on public.entries (project_id) where deleted_at is null and done_at is null;

create or replace function public.entries_project_top_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.project_id is not null
     and exists (select 1 from public.projects p where p.id = new.project_id and p.parent_id is not null) then
    raise exception 'Der Kontext eines Eintrags ist ein Hauptprojekt; % ist ein Unterprojekt', new.project_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists entries_project_top_level on public.entries;
create trigger entries_project_top_level before insert or update of project_id on public.entries
  for each row execute function public.entries_project_top_level();

-- Ein Hauptprojekt, das ein Elternprojekt bekommt, ist kein Kontext mehr: seine Einträge
-- wandern zum obersten Projekt darüber.
create or replace function public.projects_entries_kontext_root()
returns trigger
language plpgsql
set search_path = ''
as $$
declare root uuid;
begin
  with recursive up as (
    select p.id, p.parent_id, 1 as depth from public.projects p where p.id = new.parent_id
    union all
    select p.id, p.parent_id, up.depth + 1 from public.projects p join up on p.id = up.parent_id
     where up.depth < 32
  )
  select up.id into root from up where up.parent_id is null limit 1;
  if root is not null then
    update public.entries set project_id = root where project_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_entries_kontext_root on public.projects;
create trigger projects_entries_kontext_root after update of parent_id on public.projects
  for each row when (old.parent_id is null and new.parent_id is not null)
  execute function public.projects_entries_kontext_root();
