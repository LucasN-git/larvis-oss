// Selbsterklärung von Larvis für Claude. Eine Quelle, zwei Ausgaben: die Kurzfassung geht
// als MCP-Server-„instructions" in jede Session (kostet dort Kontext, also knapp), die
// Langfassung liefert das Tool get_larvis_overview auf Nachfrage. Beschreibt den aktuellen
// Stand der Software — Konzepte und Regeln, nicht Tool-Signaturen (die stehen in den
// Tool-Beschreibungen). Ändert sich ein Bereich, gehört dieser Text nachgezogen.

export const LARVIS_INSTRUCTIONS = `Larvis ist ein persönliches Life-OS (Web-App auf Supabase, ein Nutzer), vollständig über diese Tools bedienbar. Die Bereiche und wofür sie da sind:
- Dump (inbox): roher Eingangsstapel für Links, Gedanken, Dateien — Claude arbeitet ihn ab (ansehen, als Eintrag einordnen, auflösen) und leert ihn.
- Inbox-Tab (entries): sortierte Sammlung von Funden über Fremdes (Video, Artikel, Rezept …) in frei vergebenen thematischen Bereichen (list_areas zeigt die vorhandenen; wiederverwenden statt neu erfinden); der eigene Kommentar beim Speichern steht im Eintrag (comment) und ist Teil der Volltextsuche.
- Notizen (notes): schnelles, projektgebundenes Festhalten von eigenem Wissen; darf roh und unfertig sein.
- Learnings (learnings): das kuratierte Wiki — aufgeräumte, aktuelle Fassung eines Themas mit Grafiken; frei vergebene Bereiche wie bei Einträgen, fester Slug, Belege aus Einträgen und Notizen.
- Dinge (items): wo ein Gegenstand liegt. Projekte/ToDos, Kontakte, Kalender, Memories (Fakten über den Nutzer und Regeln für Agenten), Briefings, Wetter; optionale Module (nur wenn konfiguriert): Learnweb (Uni-Kurse), Mensa.
- Orte (places): Stammdaten für Termin-Orte mit Auto-Fahrzeit ab dem Heimatort.
Termine und ToDos bekommen möglichst Projekt, Ort und Erinnerung; ToDos immer mit due_at, weil die Startseite nur fällige und überfällige ToDos zeigt.
Faustregel: Fremdes → Dump (mit Kommentar) → Eintrag im thematischen Bereich, Form ist ein Tag; eigenes Wissen schnell → Notiz; dauerhaft und schön → Learning; Fakt über den Nutzer → Memory. Alles ist Soft-Delete (delete_*/restore_*). Für Details und Regeln: get_larvis_overview.`;

export const LARVIS_OVERVIEW_MD = `# Larvis — wie die Software funktioniert

Larvis ist ein persönliches Life-OS: eine Web-App (Handy als PWA, PC, Kiosk-Dashboard)
auf Supabase (Postgres, Auth, Realtime, Storage), vollständig über diesen MCP-Server bedienbar.
Ein Nutzer, ein Datenbestand. Schreibvorgänge erscheinen per Realtime sofort in der App.
Inhalte werden nie hart gelöscht: \`delete_*\` blendet aus (Soft-Delete), \`restore_*\` holt
zurück; Notizen und Projekte kennen zusätzlich eine Archiv-Stufe.

## Die Bereiche und wofür sie da sind

### Dump (Tabelle \`inbox\`)
Der rohe Eingangsstapel: Links, Gedanken, Dateien, die der Nutzer schnell loswerden will (auch per
Handy-Kurzbefehl). Zu jedem Item kann der Nutzer beim Speichern einen eigenen Kommentar mitgeben
(\`note\`): warum es aufgehoben wird, was daran wichtig ist. Nichts bleibt hier dauerhaft. Claude
arbeitet den Dump ab: Item ansehen, in einen oder mehrere Einträge einordnen, dann
\`resolve_inbox_item\`. Tools: \`list_inbox\`, \`add_inbox_item\`, \`mark_inbox_scanned\`,
\`resolve_inbox_item\`.

### Inbox-Tab (Tabelle \`entries\`)
Die sortierte Sammlung von Funden — aus dem Dump oder von Hand. Ein Eintrag beschreibt etwas
**Fremdes** (ein Video, einen Artikel, ein Rezept, einen Ort), nicht eigenes Wissen. Oberste
Facette ist der thematische Bereich: ein kurzer, frei vergebener Text (klein geschrieben, etwa
„kochen" oder „reisen"). Vordefinierte Bereiche gibt es nicht; es gibt genau die, die in der
Datenbank vorkommen, und \`list_areas\` zählt sie auf. Vor dem Einordnen einen vorhandenen
Bereich wiederverwenden (gleiche Schreibweise) und nur dann einen neuen anlegen, wenn keiner
passt. Ein Eintrag liegt dort, wo man ihn suchen würde. Die Form eines Fundes ist kein
Bereich, sondern ein Tag (\`nachmachen\`, \`idee\`). Ein Fund, der für zwei
Themen taugt, hat einen Hauptbereich (\`area\`) und den zweiten in \`also_areas\` — er wird
nicht zweimal angelegt; ein Bereichsfilter findet ihn in beiden. Darunter
Freitext-Kategorie, Tags, Notizen und die Quelle (Plattform, Medientyp, Autor, Länge).
\`comment\` hält die eigenen Worte des Nutzers, warum er den Fund gespeichert hat — wörtlich aus dem
Dump-Kommentar übernommen, bei erneutem Speichern um eine datierte Zeile ergänzt. Kommentar
und Tags sind Teil der Volltextsuche; die Datenbank sortiert Treffer nicht nach Relevanz, das
Gewichten nach Kommentar übernimmt der aufrufende Agent. Zwei verschiedene Funde aus derselben
Quelle (etwa der Inhalt eines Videos und die Technik, die es zeigt) sind zwei Einträge mit
derselben URL. Tools: \`list_areas\`, \`list_entries\`, \`find_entry\`, \`upsert_entry\` (die
Bereichsregeln stehen in seiner Beschreibung), \`delete_entry\`, \`restore_entry\`.

### Notizen (Tabelle \`notes\`)
Schnelles Festhalten von **eigenem** Wissen, immer an einem Projekt und dort verwaltet (eine
eigene Notizen-Seite gibt es nicht; eine Notiz ohne Projekt gehört zu „Persönlich"). Ordnerbaum je Projekt (ein Ordner ist eine Notiz mit Unternotizen), Markdown,
eingefügte Screenshots und Dateianhänge. Notizen dürfen roh und unfertig sein und werden
überschrieben. Eine Notiz kann ein Emoji als \`icon\` tragen und einen Themen-Graph (\`graph\`:
Knoten und Kanten, in der App interaktiv gezeichnet) halten.
Ausnahme vom Überschreiben: Notizen, die einen Standpunkt über lange Zeit fortschreiben (etwa
ein Jahresrückblick), bekommen von Zeit zu Zeit eine neue Version — \`create_note_version\` kopiert
die aktuelle Fassung, danach wird die Kopie mit \`update_note\` geändert; die alte Fassung ist
eingefroren und bleibt lesbar (\`list_note_versions\`). Tools: \`list_notes\`,
\`search_notes\`, \`get_note\`, \`create_note\`, \`update_note\`, \`create_note_version\`,
\`list_note_versions\`, \`archive_note\`, \`delete_note\`, \`list_note_attachments\`.

### Learnings (Tabelle \`learnings\`) — das Wiki
Eigene Aussagen des Nutzers, destilliert aus Einträgen (fremde Funde) und Notizen (eigene
Erfahrung): die aufgeräumte, schön geschriebene, **aktuelle** Position zu einem Thema — ganze
Sätze, Gegenwart, keine Änderungshistorie, mit Grafiken. Eine Seite fasst ihre Quellen nicht
zusammen, sie sagt, was der Nutzer denkt; die Quellen hängen als Belege daran (Tabelle
\`learning_sources\`, je Beleg eine Rolle: beleg, beispiel, gegenbeispiel, erfahrung, plus ein
Satz, was die Quelle zeigt). Bereiche sind frei vergeben wie bei Einträgen (\`list_areas\`);
eine Seite liegt im Gebiet, in dem ihre Aussage gilt. Darunter ein Seitenbaum. Jede Seite hat einen festen
Slug: URL \`/learnings/<slug>\`, Upsert-Schlüssel und Ziel interner Links. Grafiken erzeugt
Claude als SVG und lädt sie mit \`upload_learning_image\` hoch; die Seite bindet sie als
\`![…](larvis-att:<id>)\` ein. Nachziehen: \`list_undistilled\` liefert Einträge
ohne Beleg-Verknüpfung (mit \`include_notes\` auch Notizen); Claude schlägt vor, welche These sie stärken, kippen oder neu
begründen, der Nutzer entscheidet. Tools: \`list_learnings\`, \`get_learning\`,
\`upsert_learning\`, \`delete_learning\`, \`restore_learning\`, \`link_learning_source\`,
\`unlink_learning_source\`, \`list_undistilled\`, \`upload_learning_image\`,
\`list_learning_attachments\`, \`delete_learning_attachment\`.

### Dinge (Tabelle \`items\`)
Wo ein Gegenstand physisch liegt: Name, Ort, Kategorie, Notiz. Tools: \`list_items\`,
\`find_item\`, \`upsert_item\`, \`delete_item\`, \`restore_item\`.

### Projekte und ToDos (Tabellen \`projects\`, \`todos\`)
Projekte mit Unterprojekten, Status active/paused/done/archived, Farbe, Icon und lokalem
Ordner. Die Farbe kennzeichnet die Kategorie: nur das Top-Level-Projekt trägt eine, Unterprojekte
erben sie (\`effective_color\`), ToDos und Termine färben sich danach. Die Farben
stammen aus einer festen Palette; das Projekt „Persönlich" (Slug \`persoenlich\`) ist
Violett. ToDos gehören zu einem Projekt oder zum Bereich personal, haben Priorität, Fälligkeit
(immer setzen), Backlog-Flag und können in den Google-Kalender gespiegelt werden. Tools: \`list_projects\`,
\`get_project\`, \`create_project\`, \`update_project\`, \`archive_project\`, \`list_todos\`,
\`create_todo\`, \`update_todo\`, \`complete_todo\`, \`delete_todo\`.

### Memories (Tabelle \`memories\`)
Dauerhafte Fakten über den Nutzer, Vorlieben und Arbeitsvereinbarungen für Agenten — ein Fakt pro
Memory, Upsert auf Slug, Arten user/feedback/project/reference/skill. Sie lassen sich per
\`npm run memory:sync\` in eine CLAUDE.md spiegeln und kosten dort in jeder Session Kontext:
kurz halten. Tools:
\`list_memories\`, \`save_memory\`, \`delete_memory\` (hart).

### Orte (Tabelle \`places\`)
Stammdaten für wiederkehrende Termin-Orte: Name (unter lebenden Orten eindeutig), Adresse,
Stadt, Aliase zum Wiedererkennen in Termin-Locations. \`travel_minutes\` ist die Auto-Fahrzeit
ab dem Heimatort und bestimmt, wie früh die Erinnerung kommt; null heißt unbekannt oder innerorts.
In der App pflegt der Tab „Orte“ sie; der Termin-Editor schlägt sie als Ort vor und
ordnet einen Termin zu, dessen Ort exakt einem Namen oder Alias entspricht.
Einen Startbestand gibt es nicht. Tools: \`list_places\`,
\`upsert_place\`, \`delete_place\`, \`restore_place\`.

### Kontakte, Kalender, Briefings, Wetter
Kontakte (privat und geschäftlich, Geburtstage, Links): \`list_contacts\`, \`get_contact\`,
\`upsert_contact\`. Kalender: \`list_calendar_events\` liest alle sichtbaren Google-Kalender
plus die Kalender-Abos zusammen; geschrieben wird nur in Google über
\`create_calendar_event\`, \`update_calendar_event\`, \`delete_calendar_event\`. Kalender-Abos
(Outlook, Arbeits-Google über einen geheimen ICS-Link) sind schreibgeschützt: ihre Termine
tragen \`calendar: "subscription"\` und \`editable: false\`, Larvis ändert sie nie;
\`list_calendar_subscriptions\` zeigt die Abos mit Status und Projekt, angelegt, umbenannt und
einem Projekt zugeordnet werden sie in der Web-App (Kalender → Kalender-Abos). Ein Abo mit
Projekt gibt dessen \`project_id\` an alle seine Termine weiter; sie erscheinen dann in der
Projektfarbe. Ein Termin trägt Projekt, Tags und Ort (\`place_id\`).
Erinnerung: Standard 30 Minuten vorher, ganztägige Termine keine; \`reminder_minutes\`
(null = aus) oder \`reminder_at\` ersetzt den Standard. Das tägliche
Morgen-Briefing: \`get_briefing\`, \`save_briefing\`. Wetter am konfigurierten Ort:
\`get_weather\` (ohne Ort meldet es „nicht konfiguriert").

### Optionale Module: Learnweb und Mensa
Beide sind standardmäßig aus und haben dann keine Tools; sie betreffen die Uni Münster.
Learnweb (Tabellen \`learnweb_*\`) spiegelt die Kurse aus deren Moodle: Kurse (an ein Projekt
koppelbar), Materialien, Vorlesungsvideos mit Transkript (lokal per
\`scripts/learnweb/transcribe-queue.mjs\`), Ankündigungen und Termine. Tools: \`learnweb_list_courses\`, \`learnweb_get_course\`, \`learnweb_list_videos\`,
\`learnweb_get_transcript\`, \`learnweb_search_transcripts\`, \`learnweb_queue_transcription\`,
\`learnweb_link_project\`, \`learnweb_sync\`. Mensa liest den Speiseplan der konfigurierten
Mensen über OpenMensa: \`get_mensa_menu\`.

### Agent-Queue (Tabelle \`agent_tasks\`)
Aufgaben an einem Projekt, die ein lokaler Runner headless mit Claude abarbeitet; ohne
Oberfläche in der App, nur MCP und Runner. Tools:
\`create_agent_task\`, \`list_agent_tasks\`, \`claim_next_agent_task\`, \`update_agent_task\`.

### Startseite und was nur in der App liegt
Die Startseite zeigt die Abfahrtstafel für heute und die ToDos, die heute fällig oder
überfällig sind. Push-Abos und Datei-Uploads in den Dump gibt es nur in der App; MCP liest
Dateien über signierte URLs.

## Welcher Ort für was
- Etwas Fremdes aufheben (Link, Fund, Tipp, Rezept) → Dump (mit Kommentar) → Eintrag im thematischen Bereich; die Form (Tipp, zum Nachmachen, Idee) ist ein Tag.
- Eigenes Wissen schnell festhalten, projektbezogen → Notiz.
- Wissen kuratiert, dauerhaft und schön erklären, mit Grafik → Learning.
- Fakt über den Nutzer oder Regel für Agenten → Memory.
- Wo liegt ein Gegenstand → Dinge.
- Etwas tun → ToDo; etwas Größeres → Projekt.
- Recall über Notizen, Dinge, ToDos, Projekte, Kontakte, Einträge und Learnings → \`search_everything\`.

## Regeln
- Tool-Beschreibungen sind der Vertrag: Bereichs-, Kategorie- und Slug-Regeln stehen dort, nicht hier.
- Nie hart löschen; \`delete_*\` ist Soft-Delete, \`restore_*\` holt zurück (Ausnahme: Memories).
- Bodies sind Markdown; \`upsert_learning\` ersetzt den ganzen Body — vorher \`get_learning\`.
- Neue oder umbenannte Tools erscheinen erst nach einem Deploy und in einer frischen Session.
`;
