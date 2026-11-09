# @larvis/mcp-server

Lokaler MCP-Server, über den Claude dein Larvis vollständig bedient: Projekte, ToDos,
Notizen, das kuratierte Wiki (Learnings), Dinge, Einträge (die sortierte Sammlung), Agent-Tasks und Kalender (Google plus Kalender-Abos). Läuft per stdio und verbindet sich mit
dem **Service-Role-Key** (umgeht RLS) direkt mit deiner Supabase-DB.

## Build

```bash
npm run build:mcp        # baut @larvis/shared + diesen Server nach dist/
```

## In Claude eintragen

Claude Code (`~/.claude/.mcp.json` oder Projekt-`.mcp.json`), bzw. Claude Desktop
(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "larvis": {
      "command": "node",
      "args": ["/pfad/zu/larvis/packages/mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "http://127.0.0.1:54321",
        "SUPABASE_SERVICE_ROLE_KEY": "<service_role_key, lokal aus `supabase status`>",
        "GOOGLE_CLIENT_ID": "<optional, für Kalender-Tools>",
        "GOOGLE_CLIENT_SECRET": "<optional>",
        "LARVIS_OWNER_ID": "<UUID deines Kontos aus auth.users>",
        "WEATHER_PLACE": "<optional, Ort fürs Wetter, dazu WEATHER_LAT/WEATHER_LON>",
        "HOME_PLACE": "<optional, Heimatort für Fahrzeiten>"
      }
    }
  }
}
```

Der `service_role`-Key ist ein Admin-Schlüssel. Nur hier lokal eintragen, nie ins Repo,
nie in den Client.

## Tools

Die folgende Übersicht nennt die Hauptgruppen, nicht jedes einzelne Tool — maßgeblich ist
`src/tools/`, eine Datei pro Bereich. Lokal und über den claude.ai-Connector ist die Liste
gleich. Die optionalen Module stehen nur bereit, wenn sie in der Umgebung des Servers
eingeschaltet sind (`src/config.ts`): Learnweb mit `LEARNWEB_ENABLED=1`, Mensa mit
`MENSA_CANTEENS`; `get_weather` gibt es immer, ohne `WEATHER_PLACE`/`WEATHER_LAT`/`WEATHER_LON`
meldet es „nicht konfiguriert". Jeder Name gilt auch mit dem `VITE_`-Präfix der Web-App.

**Projekte:** `list_projects`, `get_project`, `create_project`, `update_project`, `archive_project`

**ToDos:** `list_todos`, `create_todo`, `update_todo`, `complete_todo`, `delete_todo`

**Notizen:** `list_notes`, `search_notes`, `get_note`, `create_note`, `update_note`,
`archive_note`, `unarchive_note`, `delete_note`, `restore_note`, `list_note_attachments`,
`create_note_version`, `list_note_versions`. `create_note` und `update_note` nehmen ein `icon`
(Emoji) und einen Themen-Graph `graph` (`{ nodes, edges, groups? }`) an; der Graph wird beim
Schreiben geprüft (mindestens ein Knoten, eindeutige Knoten-ids, Kanten nur zwischen
vorhandenen Knoten, `weight` 1–5, keine unbekannten Felder; Logik in `src/noteVersions.ts`,
Tests in `test/`). Langlebige Notizen werden versioniert statt überschrieben:
`create_note_version` kopiert die aktuelle Version einer Serie (ohne Anhänge) in eine neue mit
`version_no + 1`, friert die ältere ein (`superseded_at`) und hängt deren nicht gelöschte
Unternotizen an die neue Version um, wie die Web-App; danach wird die neue Version mit
`update_note` geändert. Eine eingefrorene Version weist `update_note` ab, außer mit
`force: true`. `list_notes` und `search_notes` blenden eingefrorene Versionen aus, solange
`include_superseded` nicht gesetzt ist; `search_everything` zeigt nur aktuelle Versionen.

**Dinge:** `list_items`, `find_item`, `upsert_item`, `delete_item`

**Agent-Queue:** `create_agent_task`, `list_agent_tasks`, `claim_next_agent_task`, `update_agent_task`

**Kalender:** `list_calendar_events`, `list_calendar_subscriptions`, `create_calendar_event`,
`update_calendar_event`, `delete_calendar_event`. `list_calendar_events` führt alle sichtbaren
Google-Kalender, den Larvis-Kalender und die eingeschalteten Kalender-Abos zusammen. Kalender-Abos
sind fremde Kalender (etwa Outlook oder ein Google-Arbeitskonto), die Larvis über einen geheimen ICS-Link
nur liest: ihre Termine tragen `calendar: "subscription"`, `calendar_id: "sub:<abo-id>"` und
`editable: false`; `update_calendar_event` und `delete_calendar_event` weisen sie ab.
`list_calendar_subscriptions` zeigt die Abos mit Name, Farbe, Projekt (`project_id` und
`project: { id, name }`), Schalter und Abrufstatus, den Link nur als `url_hint` (Host plus
maskiertes Ende). Ein Abo mit Projekt gibt seine `project_id` an alle seine Termine weiter; die
Termine erscheinen dann in der Projektfarbe, `color` ist die Farbe des Abos ohne Projekt.
Angelegt, umbenannt, einem Projekt zugeordnet und gelöscht werden Abos nur in der Web-App. Kann ein Kalender gerade nicht gelesen werden, liefert `list_calendar_events`
`{ events, errors }` statt der reinen Liste.
`create_calendar_event` und `update_calendar_event` nehmen zusätzlich `place_id` (Verknüpfung mit einem Ort, null löst sie).
`reminder_minutes` setzt einen eigenen Vorlauf (null = Erinnerung aus), `reminder_at` den Zeitpunkt exakt; ohne beides gilt beim Anlegen der Standard (Vorlauf des Themas Termine, ab Werk 30 Minuten, ganztägig keiner), beim Ändern bleibt die Erinnerung, wie sie ist. Die Antwort trägt `reminder: {mode: default|custom|off, notify_at}`; ein verschobener Termin nimmt seine eigene Erinnerung mit gleichem Vorlauf mit, `delete_calendar_event` entfernt sie.

**Einträge (Tabelle `entries`, Tab „Inbox"):** `list_areas`, `list_entries`, `find_entry`,
`upsert_entry`, `delete_entry`, `restore_entry`. Ein Eintrag hat einen thematischen Bereich
(`area`): einen frei vergebenen, kurzen Text, gespeichert klein und getrimmt. Vordefinierte
Bereiche gibt es nicht; `list_areas` zählt die vorhandenen (aus Einträgen und Learnings, je mit
Anzahl) auf, damit Claude dieselben Namen wiederverwendet. Ein Eintrag liegt dort, wo man ihn
suchen würde; die Form (zum Nachmachen, Idee) ist ein Tag (`nachmachen`, `idee`). Ein Fund, der für zwei
Themen taugt, hat einen Hauptbereich und den zweiten in `also_areas` (nicht zweimal anlegen);
der Bereichsfilter von `list_entries` und `find_entry` trifft beide. Dazu Freitext-`category`,
Tags, `comment`, `notes_md` und `source_*`-Felder zur Quelle (Plattform, Medientyp, Autor,
Länge). `comment` hält die eigenen Worte des Nutzers, warum er den Fund gespeichert hat: Claude
übernimmt den Dump-Kommentar wörtlich und hängt bei erneutem Speichern eine datierte Zeile
an. `comment` und Tags sind Teil der Volltextsuche; die Treffer kommen ungerankt, das
Gewichten nach Kommentar übernimmt der Aufrufer. `list_entries` und `find_entry` liefern
mit `brief: true` nur die Felder zum Überfliegen: id, area, also_areas, name, url,
category, tags, description, comment, source_platform, source_author_handle, source_title,
upload_id, created_at (ohne `notes_md` und Datei-Embed). Eine Quelle darf mehrere Einträge erzeugen (gleiche `url`). Die Bereichs-Regeln stehen in der
Beschreibung von `upsert_entry` — sie sind der Vertrag für einen Skill, der den Dump
einsortiert.

**Dump:** `list_inbox` (mit `unscanned_only`; Datei-Items tragen `upload` samt `signed_url`,
~6 h gültig, `note` ist der eigene Kommentar beim Speichern), `add_inbox_item` (mit optionalem
`note`), `mark_inbox_scanned`, `resolve_inbox_item`,
`delete_inbox_item`, `restore_inbox_item`. Zwei getrennte Zustände: *gescannt* (`scanned_at`,
Claude hat es angesehen, bleibt sichtbar) und *erledigt* (`processed`, verschwindet); Auflösen
setzt beides. Dateien werden nur in der Web-App hochgeladen (Bucket `uploads`, Tabelle
`uploads`); Dump-Item und der daraus entstandene Eintrag zeigen per `upload_id` auf dieselbe
Zeile.

**Learnings (Tabellen `learnings`, `learning_sources`, Tab „Learnings"):** `list_learnings`,
`get_learning`, `upsert_learning`, `delete_learning`, `restore_learning`, `link_learning_source`,
`unlink_learning_source`, `list_undistilled`, `upload_learning_image`, `list_learning_attachments`,
`delete_learning_attachment`. Das Wiki hält die eigenen Aussagen des Nutzers, destilliert aus Einträgen
(fremde Funde) und Notizen (eigene Erfahrung) — keine Zusammenfassung der Quellen, sondern die
eigene Position, mit den Quellen als Belegen daran (`link_learning_source`: genau ein Eintrag oder
eine Notiz, Rolle `beleg`, `beispiel`, `gegenbeispiel` oder `erfahrung`, ein Satz, was die Quelle
zeigt). Bereiche sind frei vergeben wie bei Einträgen (`list_areas`); eine Seite liegt im Gebiet,
in dem ihre Aussage gilt. Ein Seitenbaum je Bereich (`parent_slug`), der Slug ist die feste Adresse und
der Upsert-Schlüssel. `upsert_learning` ersetzt den ganzen Body (vorher `get_learning`).
`list_undistilled` ist der Nachzieh-Stapel: Einträge, die noch kein lebendes Learning belegt (mit
`include_notes` auch Notizen). Grafiken gehen als SVG/PNG über `upload_learning_image`
(nur base64 — bewusst kein Dateipfad, weil das Tool auch über den Remote-Endpunkt erreichbar
ist und ein Pfad ein beliebiger Datei-Lesezugriff auf dem Server wäre) in den privaten Bucket
`learning-files`; das Tool gibt die Markdown-Referenz `![…](larvis-att:<id>)` zurück, die in
den Body gehört. Die Regeln in den Tool-Beschreibungen sind der Vertrag für Claude.

**Selbsterklärung:** `get_larvis_overview` erklärt die Software — wofür Dump, Inbox-Tab,
Notizen, Learnings, Dinge, Projekte, Memories usw. da sind und welcher Ort für was gilt. Die
Kurzfassung davon geht als Server-`instructions` an jeden Client (Quelle:
`packages/shared/src/overview.ts`; bei Bereichsänderungen dort nachziehen).

**Recall:** `search_everything` (sucht Notizen, Dinge, ToDos, Projekte, Kontakte, Einträge und Learnings
in einem Aufruf)

## Schnelltest (ohne Claude)

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node dist/index.js
# dann JSON-RPC initialize + tools/list über stdin senden
```

`area` heißt in Notizen, Dingen und ToDos `project` oder `personal` (= dein Bereich „Persönlich");
in `entries` und `learnings` ist es der frei vergebene thematische Bereich. Schreibvorgänge erscheinen
dank Supabase Realtime sofort in App und Dashboard.

## Agent-Runner (optional, nimmt Aufgaben ab)

Aufträge kommen über das MCP-Tool `create_agent_task` in die Queue (`agent_tasks`). Der Runner pollt
die Queue, nimmt die älteste `queued`-Aufgabe und führt sie headless via Claude Code aus
(`claude -p`). Weil der Larvis-MCP in deinem Claude hängt, kann der Agent dabei selbst
Larvis-Tools nutzen.

```bash
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run runner -w @larvis/mcp-server
```

Der Runner **führt KI-generierte Aktionen automatisch aus**. Starte ihn bewusst. Optionen
über Env: `LARVIS_RUNNER_INTERVAL` (ms), `LARVIS_CLAUDE_BIN` (Pfad zum claude-Binary).
Status/Ergebnis landen in der Task und erscheinen live in der App.
