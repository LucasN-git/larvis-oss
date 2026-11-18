# Larvis

Larvis ist ein persönliches Life-OS für eine Person: Projekte und ToDos, Notizen, ein eigenes
Wiki, eine Sammlung gespeicherter Funde, Kalender, Kontakte und ein paar Alltagsanzeigen in
einer Web-App — und alles davon lässt sich über Claude bedienen. Ein MCP-Server gibt Claude
Werkzeuge für jeden Bereich, sodass du Larvis genauso gut im Chat („leg mir ein ToDo für
Freitag an", „was hab ich zum Thema kochen gespeichert?") wie in der App benutzt.

Die App ist eine PWA für Handy und Desktop, dazu gibt es eine Kiosk-Ansicht für einen fest
montierten Bildschirm. Daten, Anmeldung und Dateien liegen in einer eigenen Supabase-Instanz;
Larvis ist für den Eigenbetrieb gedacht, jede Installation gehört genau einem Nutzer.

## Was Larvis kann

- **Heute:** die Termine des Tages als Abfahrtstafel, dazu die ToDos, die heute fällig oder
  überfällig sind, ein Schnell-Eingang („Dump") und Widgets.
- **Projekte, ToDos, Notizen:** Projekte mit Unterprojekten und vererbter Farbe; ToDos mit
  Fälligkeit, Priorität, Backlog und Wischgesten auf dem Handy; Notizen als Ordnerbaum je
  Projekt, in Markdown, mit eingefügten Bildern, Anhängen, Emoji-Icon und einem interaktiven
  Themen-Graphen. Notizen, die einen Standpunkt über lange Zeit fortschreiben, lassen sich
  versionieren; ältere Fassungen bleiben lesbar und vergleichbar.
- **Dump und Inbox:** Links, Gedanken und Dateien landen erst im Dump (auch per
  iOS-Kurzbefehl, samt eigenem Kommentar, warum du sie aufhebst). Claude sortiert sie danach als
  Einträge in die Inbox: eine Sammlung fremder Funde (Artikel, Videos, Rezepte, Orte …) mit
  Quelle, Kategorie, Tags und Volltextsuche.
- **Machen:** Einträge mit dem Tag `nachmachen` oder `umsetzen` stehen zusätzlich als
  Abhakliste im Tab „Machen", gruppiert nach ihrem Kontext (dem Projekt, für das sie
  gespeichert wurden). Abhaken setzt sie auf erledigt; sie bleiben in der Inbox.
- **Frei vergebene Bereiche:** Einträge und Wiki-Seiten liegen in Bereichen, die du selbst
  benennst („kochen", „reisen" …). Es gibt keine vorgegebenen Bereiche; die Filter entstehen aus
  dem, was du anlegst, und Claude fragt über `list_areas` ab, welche es schon gibt.
- **Learnings (Wiki):** die kuratierte, eigene Fassung eines Themas in ganzen Sätzen, mit
  Grafiken und mit Belegen aus Einträgen und Notizen. Jede Seite hat eine feste Adresse.
- **Podcasts und Erklärvideos:** fertige Folgen und Videos zum Hören und Ansehen, je einem
  Projekt zugeordnet, mit Kapiteln, Tempo, Bild-in-Bild und einem Hör- und Sehstand, der auf
  Handy und PC derselbe ist. Eine Folge lässt sich als Video teilen (WhatsApp, AirDrop, Mail).
  Erzeugt werden sie außerhalb von Larvis (siehe unten).
- **Kalender:** ein verbundenes Google-Konto (lesen und schreiben, eigener Kalender „Larvis")
  plus beliebig viele Kalender-Abos über einen geheimen ICS-Link, die nur gelesen werden.
  Ansichten Monat, Agenda, Tafel und Geburtstage; ToDos lassen sich in den Kalender spiegeln.
- **Kontakte, Orte, Dinge:** ein Adressbuch mit Geburtstagen (Import aus vCard und
  LinkedIn-Export), Orte für Termine mit Fahrzeit ab deinem Heimatort, und wo ein Gegenstand
  liegt.
- **Benachrichtigungen:** Web-Push für Termine, ToDos, Geburtstage und einen Tagesüberblick,
  mit eigenen Erinnerungen je Termin oder ToDo.
- **Für Claude:** Memories (Fakten und Arbeitsregeln, die Claude über dich wissen soll),
  Tages-Briefings und eine Agent-Queue, die ein lokaler Runner headless mit Claude Code
  abarbeitet.
- **Wetter** am konfigurierten Ort und ein Pomodoro-Timer.

Alles ist Soft-Delete: Gelöschtes verschwindet aus der App, bleibt aber in der Datenbank und
lässt sich (über Claude) wiederherstellen.

## Optionale Module

Drei Module sind auf die Uni und die Stadtwerke Münster zugeschnitten. Sie sind standardmäßig
aus; ohne ihre Konfiguration zeigt die App weder Karten noch Tabs dafür, und der MCP-Server
bietet ihre Tools nicht an.

| Modul | Was es tut | Einschalten |
|---|---|---|
| Learnweb | spiegelt Kurse, Materialien, Termine und Vorlesungsvideos aus dem Moodle der Uni Münster (nur lesend) und transkribiert Videos lokal | `VITE_LEARNWEB_ENABLED=1` bzw. `LEARNWEB_ENABLED=1`, dazu `LEARNWEB_USERNAME`/`LEARNWEB_PASSWORD` |
| Mensa | Speiseplan der Mensen des Studierendenwerks über OpenMensa | `VITE_MENSA_CANTEENS=<id>=<Name>,…` bzw. `MENSA_CANTEENS` |
| Bus | Live-Abfahrten an einer Haltestelle aus dem Busradar der Stadtwerke Münster | `VITE_BUS_STOP_ID`, optional `VITE_BUS_STOP_NAME` |

Ortsneutral und ebenfalls über die Umgebung gesetzt: der Ort fürs Wetter
(`VITE_WEATHER_PLACE`, `VITE_WEATHER_LAT`, `VITE_WEATHER_LON`; ohne ihn kein Wetter) und der
Heimatort als Text, ab dem die Fahrzeit zu Orten gemeint ist (`VITE_HOME_PLACE`). Alle Werte
mit Beispielen stehen in [`apps/web/.env.example`](./apps/web/.env.example). Der MCP-Server
liest dieselben Namen ohne `VITE_`-Präfix und fällt auf die `VITE_`-Namen zurück.

## Podcasts und Erklärvideos

Larvis spielt Folgen und Erklärvideos nur ab und teilt sie; es erzeugt keine. Der Tab
„Podcasts" zeigt sie nach Projekt gruppiert, eine Projektseite die ihres Teilbaums. Folge und
Video zum selben Thema (gleicher Slug) stehen beieinander, und man wechselt mit einem Klick
zwischen Hören und Ansehen.

Erzeugt werden sie mit dem Claude-Code-Plugin `explainers`, das nicht Teil dieses Repos ist. Es
macht aus einem Paper, einem Vorlesungsskript oder einem anderen Text eine Podcast-Folge mit zwei
Stimmen oder ein animiertes Erklärvideo mit Erzähler und Kapiteln, und es legt das Ergebnis in
genau dem Ordnerformat ab, das die Upload-Skripte erwarten. Installiert wird es aus dem
öffentlichen Marketplace `LucasN-git/lucas-claude-plugins`:

```bash
claude plugin marketplace add LucasN-git/lucas-claude-plugins
claude plugin install explainers@lucas-claude-plugins
```

Danach in Claude Code `/explainers:explainers-setup` aufrufen; das prüft die Voraussetzungen
und legt den ElevenLabs-Key ab. Die vollständige Liste der Voraussetzungen und Kosten steht im
README des Plugins; das Wichtigste:

- **Claude Code mit einem Claude-Abo.** Die Skripte des Plugins rufen `claude -p` auf; ein
  Anthropic-API-Key ist nicht nötig.
- **Ein ElevenLabs-Konto mit API-Key** für die Stimmen. Ein bezahlter Plan ist zu empfehlen,
  das kostenlose Monatskontingent reicht nicht einmal für ein Video. Abgerechnet wird nach
  Zeichen: ein Erklärvideo braucht rund 12.000 bis 13.000 Zeichen, eine Podcast-Folge mit zwei
  Stimmen rund 15.000 bis 28.000. Der Key steht in der Umgebung als `ELEVENLABS_API_KEY` oder
  dort, wo ihn `/explainers:explainers-setup` ablegt. Vertont wird erst nach deiner
  ausdrücklichen Freigabe; vorher zeigt das Plugin, wie viele Zeichen es braucht und wie viele
  dir bleiben.
- **ffmpeg** (mit `ffprobe`, libmp3lame und libx264), **poppler** (`pdftotext`, `pdfinfo`,
  `pdfunite` für PDF-Quellen), **Python 3.10 oder neuer** mit `faster-whisper` (Zeitmarken der
  Sprache, läuft lokal), **Node 20** und optional **Google Chrome** oder Chromium (nur für das
  Teil-Video einer Folge).
- **Den Service-Role-Key deiner Supabase** in der `.env.local` dieses Repos, zusammen mit
  `SUPABASE_URL` und `LARVIS_OWNER_ID` (siehe Schnellstart, Schritt 3). Hochgeladen wird mit den
  Upload-Skripten dieses Repos, entweder von dir selbst oder durch den Skill des Plugins, nachdem
  du den Upload freigegeben hast:

```bash
node --env-file=.env.local scripts/podcasts/upload.mjs <ordner> --project <projekt-slug>
node --env-file=.env.local scripts/videos/upload.mjs <ordner> --project <projekt-slug>
```

Das Ordnerformat (Dateinamen, Felder der JSON-Datei, Grenzen) steht in
[`scripts/README.md`](./scripts/README.md#paketformat-der-upload-skripte); wer Folgen oder
Videos auf anderem Weg erzeugt, legt sie genauso ab. Keine Datei darf größer als 50 MB sein.

## Aufbau

```
apps/web            Web-App (Vite, React, TypeScript) plus api/ (API-Handler) und server/ (Node-Server für beides)
packages/shared     gemeinsame Typen, Logik und die generierten Datenbank-Typen
packages/mcp-server MCP-Server für Claude (stdio) und Agent-Runner
supabase/           config.toml für die lokale Supabase und migrations/ (das Schema)
scripts/            Wartungsskripte: Kontakte importieren, Memories spiegeln, Learnweb, Podcasts und Erklärvideos hochladen
deploy/             Eigenbetrieb auf einem Server mit Docker (siehe deploy/README.md)
claudeai-skills/    ein Beispiel-Skill für claude.ai
```

Das Schema steht in `supabase/migrations/`: die Basis `20260101000000_basis.sql` und daneben
jede spätere Änderung als eigene Datei (etwa `20261115120000_entries_kontext.sql` für Kontext und
„Machen", `20261118120000_podcasts_erklaervideos.sql` für Podcasts und Erklärvideos), eingespielt in der Reihenfolge der Dateinamen. Nach einer Schema-Änderung die Typen
neu erzeugen:
`supabase gen types typescript --local > packages/shared/src/database.types.ts`.

## Schnellstart lokal

Voraussetzungen: Node 20 oder neuer (`.nvmrc`), Docker und die
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

### 1. Abhängigkeiten und Supabase

```bash
npm install
supabase start      # Postgres, Auth, Storage, Realtime; spielt supabase/migrations/ ein
supabase status     # zeigt API URL, anon key und service_role key
```

`supabase db reset` setzt die lokale Datenbank neu auf. Supabase Studio läuft unter
http://localhost:54323.

### 2. Konto anlegen

Die Registrierung ist aus. Das Konto entsteht über die Admin-API (oder in Studio unter
Authentication → Add user):

```bash
curl -X POST http://127.0.0.1:54321/auth/v1/admin/users \
  -H "apikey: <service_role key>" -H "Authorization: Bearer <service_role key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"du@example.com","password":"ein-langes-passwort","email_confirm":true}'
```

Das älteste Konto ist der Owner: nur es sieht Daten. Seine UUID (`id` in der Antwort) gehört
als `LARVIS_OWNER_ID` in die Umgebung der Server-Teile.

### 3. Konfiguration

```bash
cp apps/web/.env.example apps/web/.env
```

In `apps/web/.env` mindestens `VITE_SUPABASE_URL=http://127.0.0.1:54321` und
`VITE_SUPABASE_ANON_KEY=<anon key>` eintragen, dazu nach Wunsch Wetter-Ort und Module. Für die
Skripte und den Node-Server kommt eine `.env.local` ins Repo-Wurzelverzeichnis mit
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` und `LARVIS_OWNER_ID`; die Skripte laden sie per
`node --env-file=.env.local scripts/…` (siehe `scripts/README.md`), nur `npm run memory:sync`
liest sie selbst. Der MCP-Server lädt keine Datei: er bekommt die drei Variablen über die
Claude-Konfiguration (Schritt 5) oder beim Start von Hand per
`node --env-file=.env.local packages/mcp-server/dist/index.js`. Beide Dateien sind per
`.gitignore` ausgeschlossen.

### 4. App starten

```bash
npm run dev         # http://localhost:5173, Anmeldung mit dem Konto aus Schritt 2
```

Der Dev-Server liefert die Oberfläche. Die API-Endpunkte (Google-Kalender, Kalender-Abos,
Push, Learnweb-Sync, Remote-MCP, Kurzbefehl) laufen im Node-Server der gebauten Fassung:

```bash
npm run build:selfhost -w @larvis/web
node --env-file=apps/web/.env --env-file=.env.local apps/web/server/index.mjs   # http://localhost:3000
```

### 5. Claude verbinden

```bash
npm run build:mcp
```

Dann den Server in Claude Code oder Claude Desktop eintragen, wie in
[`packages/mcp-server/README.md`](./packages/mcp-server/README.md) beschrieben (Pfad zu
`packages/mcp-server/dist/index.js` plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` und
`LARVIS_OWNER_ID`). Claude bekommt beim Verbinden eine Kurzbeschreibung von Larvis; die
ausführliche liefert das Tool `get_larvis_overview`. Im Eigenbetrieb steht derselbe Server
zusätzlich als Remote-Connector unter `https://<deine-domain>/api/mcp` bereit (Anmeldung per
OAuth über die eigene Supabase).

### Weitere Dienste

- **Google-Kalender:** in der Google Cloud Console die Calendar API aktivieren, einen
  OAuth-Client „Web application" mit der Redirect-URI
  `http://localhost:3000/api/google/oauth-callback` anlegen und `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` setzen. In der App einmal „Kalender verbinden"
  klicken; Larvis legt einen eigenen Kalender „Larvis" an.
- **Kalender-Abos:** in der App unter Kalender → Ebenen-Symbol, über den geheimen ICS-Link;
  sie funktionieren auch ohne Google.
- **Push:** ein VAPID-Schlüsselpaar (`npx web-push generate-vapid-keys`) als
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, dazu `VITE_VAPID_PUBLIC_KEY` und
  `VAPID_SUBJECT=mailto:<deine-adresse>`. Den Minuten-Tick ruft pg_cron in der Datenbank auf
  (siehe [`deploy/README.md`](./deploy/README.md)).
- **Skill für claude.ai:** `claudeai-skills/larvis-voice/` ist ein Sprach-Assistent für die
  claude.ai-App. Zum Hochladen den Ordner packen (`cd claudeai-skills && zip -r larvis-voice.zip
  larvis-voice`) und die Zip-Datei in den Einstellungen von claude.ai bei den Skills hochladen.

### Prüfen

```bash
npm run build -w @larvis/shared   # web und mcp-server lesen die Typen aus shared/dist
npm run typecheck
npm test
node --test scripts/podcasts/*.test.mjs
npm run build:selfhost -w @larvis/web
```

### Oberfläche ohne Anmeldung

`VITE_DEV_BYPASS_AUTH=1` in `apps/web/.env` lässt im Dev-Server jede Seite ohne Sitzung laden
(Leerzustände; der Kalender kommt aus `apps/web/dev/calendar-fixture.mjs`). Liegt
`~/.config/larvis/dev-session.json` mit `access_token` und `refresh_token` einer eigens dafür
angemeldeten Sitzung vor, übernimmt die App sie und zeigt echte Daten. Ein Produktions-Build
enthält weder Schalter noch Endpunkt (`apps/web/src/lib/devBypass.ts`).

## Eigenbetrieb

Larvis läuft auf einem einzelnen Linux-Server mit Docker: die App als zustandsloser Container,
daneben eine selbst gehostete Supabase, davor ein Caddy für TLS. Einrichtung, Domain, Konto,
Mailversand, Push und der optionale Deploy-Workflow stehen in
[`deploy/README.md`](./deploy/README.md).

Der Workflow `.github/workflows/release.yml` baut das Image und rollt es per SSH aus. Er
startet nur von Hand (Actions → Release → Run workflow), damit ein Fork ohne eingerichteten
Server nicht bei jedem Push scheitert; welche Repository-Variablen und Secrets er braucht,
steht in seinem Kopf. Wer automatisch ausrollen will, ergänzt unter `on:` den Auslöser
`push: branches: [main]`. Die Prüfungen aus `ci.yml` laufen bei jedem Push.

## Design

Farben, Radien, die Abstandsskala und Fonts liegen als Tokens in
[`apps/web/src/theme/tokens.ts`](./apps/web/src/theme/tokens.ts); Komponenten nutzen nur
`var(--…)`. Ein Theme dort zu ändern reskinnt die ganze App. Die Layout-Tokens hängen an zwei
Breiten-Schwellen (Handy unter 640 px, Tablet bis 1023 px, Desktop ab 1024 px) und stehen in
`theme/global.css`; `theme/breakpoints.ts` hält dieselben Werte für JavaScript, und ein Test
weist jede andere Breiten-Query zurück. Das Logo ist ein Inline-SVG
(`components/Logo.tsx`), die App-Icons entstehen aus `apps/web/public/icon.svg`.

## Skripte

| Befehl | Wirkung |
|---|---|
| `npm run dev` | Web-App im Dev-Modus |
| `npm run build` | shared und Web-App bauen |
| `npm run build:mcp` | shared und MCP-Server bauen |
| `npm run mcp` | MCP-Server starten (stdio; Umgebung siehe Schritt 3, lädt keine `.env.local`) |
| `npm run typecheck` | alle Workspaces typprüfen |
| `npm test` | Tests aller Workspaces |
| `npm run memory:sync` | Memories nach `~/.claude/globals/larvis-memories.md` schreiben, zum Einbinden in eine CLAUDE.md |

Weitere Skripte (Kontakt-Import, Learnweb, Podcasts und Erklärvideos) beschreibt [`scripts/README.md`](./scripts/README.md).

## Lizenz

MIT, siehe [LICENSE](./LICENSE).
