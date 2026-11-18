# Skripte

Wartungs- und Pipeline-Skripte. Alle lesen ihre Zugangsdaten aus der root-`.env.local`
(`node --env-file=.env.local scripts/…`), mindestens `SUPABASE_URL` und
`SUPABASE_SERVICE_ROLE_KEY`.

| Ordner/Datei | Zweck |
|---|---|
| `contacts/` | Kontakte aus einem LinkedIn-Export (`import-linkedin.mjs`) oder einer vCard-Datei (`import-vcard.mjs`) importieren, danach Dubletten zusammenführen (`merge-duplicates.mjs`, abgelehnte Paare in `rejected-pairs.json`) |
| `learnweb/` | Learnweb-Sync lokal, Fixtures für die Parser-Tests holen, Vorlesungsvideos transkribieren (lokal mit faster-whisper oder über die OpenAI-API) |
| `podcasts/` | Fertige Podcast-Folgen nach Larvis laden (`upload.mjs`, baut dabei das Teil-Video), Teil-Videos nachziehen (`backfill-share-video.mjs`); `share-video.mjs` rendert die Titelkarten-MP4 lokal |
| `videos/upload.mjs` | Fertige Erklärvideos nach Larvis laden |
| `memory/sync-claude-md.mjs` | Memories nach `~/.claude/globals/larvis-memories.md` schreiben (`npm run memory:sync`), damit Claude-Agenten sie über die globale `CLAUDE.md` im Kontext haben |
| `larvis-open`, `install-larvis-handler.sh` | `larvis://`-Links aus der App öffnen ein Terminal im Projektordner (unten) |

## Paketformat der Upload-Skripte

Larvis spielt Podcasts und Erklärvideos nur ab und teilt sie; erzeugt werden sie außerhalb, etwa
mit dem Claude-Code-Plugin „explainers" (siehe README, „Podcasts und Erklärvideos"). Ein
Erzeuger legt je Folge oder Video einen Ordner an, und die beiden Upload-Skripte laden ihn hoch.
Dieser Abschnitt ist der Vertrag zwischen beiden Seiten: was hier steht, liest das Skript, alles
andere im Ordner und in der JSON-Datei ignoriert es.

```bash
node --env-file=.env.local scripts/podcasts/upload.mjs <ordner> --project <projekt-slug> [--dry-run] [--no-share-video]
node --env-file=.env.local scripts/videos/upload.mjs   <ordner> --project <projekt-slug> [--dry-run]
```

- Umgebung: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` und `LARVIS_OWNER_ID` (aus der
  `.env.local`). Die Dateien liegen im Bucket unter `<LARVIS_OWNER_ID>/<slug>-<hash>.<endung>`;
  nur dort darf die App sie lesen.
- `--project` ist der Slug eines bestehenden, nicht gelöschten Projekts (`list_projects` über
  Claude zeigt ihn). Die Folge oder das Video erscheint unter diesem Projekt und auf seiner
  Projektseite.
- `--dry-run` prüft das Paket und lädt nichts hoch; mit gesetzter Umgebung prüft es auch das
  Projekt, ohne Umgebung nur das Paket.
- Der `slug` aus der JSON-Datei ist der feste Schlüssel: ein zweiter Upload mit demselben Slug
  ersetzt den ersten samt Kapiteln, die alten Dateien werden danach gelöscht. Folge und Video mit
  demselben Slug gehören zum selben Thema und stehen in der App beieinander, mit Wechsel-Link.
- Keine Datei darf größer als 50 MB sein (Limit der Buckets). Dateinamen in der JSON-Datei sind
  nur Namen im selben Ordner, keine Pfade.
- Exit-Code 0 heißt hochgeladen (bzw. Paket in Ordnung beim Dry-Run), 1 heißt abgebrochen mit
  Meldung auf stderr. Scheitert nur das Teil-Video einer Folge, steht die Folge trotzdem und der
  Exit-Code ist 0; die Meldung nennt den Befehl zum Nachholen.

Gemeinsame Felder beider JSON-Dateien (UTF-8):

| Feld | Pflicht | Typ | Bedeutung |
|---|---|---|---|
| `slug` | ja | String | fester Schlüssel, nur `a-z`, `A-Z`, `0-9`, `.`, `_`, `-`, beginnt mit Buchstabe oder Ziffer |
| `title` | ja | String | Titel in Liste, Player und auf der Titelkarte |
| `subtitle` | nein | String | Kurzzeile unter dem Titel, etwa `Autorin & Autor 2021 · Journal`; zugleich Dateiname beim Teilen (sonst der Titel) |
| `description` | nein | String (Markdown) | Text unter dem Player |
| `seconds` | nein, empfohlen | Zahl | Länge der Datei in Sekunden; ohne sie zeigt die Liste keine Länge, bis die Datei einmal geladen wurde |
| `chapters` | nein | Array | Kapitel, siehe unten; ohne Kapitel gibt es keine Kapitelliste und keine Kapitelsprünge |
| `file` | nein | String | anderer Dateiname der Mediendatei im Ordner |

Ein Kapitel ist `{ "id": String, "title": String, "start": Zahl, "end": Zahl }`. `start` und
`end` sind Pflicht und zählen in Sekunden der fertigen Datei (nach jeder Tempoänderung); `id`
(Standard `kapitel-<n>`) und `title` (Standard `Kapitel <n>`) sind optional. Die App sortiert
nach `start`.

### Podcast-Folge

```
<ordner>/
  episode.mp3     Pflicht; MP3, höchstens 50 MB (64 kbit/s mono: eine halbe Stunde ≈ 15 MB)
  episode.json    Pflicht
```

Zusätzlich zu den gemeinsamen Feldern:

| Feld | Pflicht | Typ | Bedeutung |
|---|---|---|---|
| `voices` | nein | Objekt | Stimmen der Folge, Schlüssel frei (etwa `A`, `B`), Wert `{ "name": String, "role": String? }`; Einträge ohne `name` fallen weg. Erscheinen unter dem Titel und auf der Titelkarte |

Das Teil-Video (dieselbe Tonspur als MP4 mit Titelkarte und laufendem Kapitel, zum Verschicken
über den Teilen-Knopf) gehört nicht ins Paket: `upload.mjs` baut es beim Hochladen selbst mit
`share-video.mjs`. Dafür braucht der Rechner `ffmpeg` und `ffprobe` im `PATH` und Google Chrome
oder Chromium (Standardort unter macOS, sonst `google-chrome`/`chromium` im `PATH`, oder
`CHROME_PATH`). `--no-share-video` lässt es weg; `backfill-share-video.mjs [slug …]` holt es
später nach.

Beispiel:

```json
{
  "slug": "smith2019-intro",
  "title": "A short introduction to examples",
  "subtitle": "Smith & Lee 2019 · Journal of Examples",
  "description": "Zwei Stimmen gehen das Paper Kapitel für Kapitel durch.",
  "seconds": 1812.4,
  "chapters": [
    { "id": "intro", "title": "Worum es geht", "start": 0, "end": 214.8 },
    { "id": "methods", "title": "Wie sie vorgehen", "start": 214.8, "end": 1812.4 }
  ],
  "voices": { "A": { "name": "Ada", "role": "erklärt" }, "B": { "name": "Ben", "role": "fragt" } }
}
```

### Erklärvideo

```
<ordner>/
  video.mp4       Pflicht; MP4 (H.264/AAC, 1920×1080, „faststart"), höchstens 50 MB
                  (15 Minuten mit Folienbildern um 400 kbit/s ≈ 45 MB)
  poster.jpg      optional (oder poster.jpeg / poster.webp); Vorschaubild, sonst eine leere Fläche
  video.json      Pflicht
```

Zusätzlich zu den gemeinsamen Feldern:

| Feld | Pflicht | Typ | Bedeutung |
|---|---|---|---|
| `narrator` | nein | Objekt | `{ "name": String }`, erscheint als „erzählt von …" |
| `poster` | nein | String | anderer Dateiname des Vorschaubilds im Ordner (`.jpg`, `.jpeg` oder `.webp`); fehlt die genannte Datei, bricht das Skript ab |

Beispiel:

```json
{
  "slug": "smith2019-intro",
  "title": "A short introduction to examples",
  "subtitle": "Smith & Lee 2019 · Journal of Examples",
  "seconds": 842.0,
  "chapters": [
    { "id": "intro", "title": "Worum es geht", "start": 0, "end": 92.4 },
    { "id": "kern", "title": "Der Kern", "start": 92.4, "end": 842.0 }
  ],
  "narrator": { "name": "Ada" }
}
```

## "Projekt-Ordner öffnen"-Links

Jedes Projekt in Larvis kann einen **lokalen Ordnerpfad** haben (Feld im
Projekt-Formular, Spalte `projects.local_path`). Auf der Projektseite erscheinen
dann drei Buttons oben rechts:

| Button | Aktion | Setup |
|--------|--------|-------|
| `</>` VS Code | öffnet den Ordner in VS Code (`vscode://file/…`) | keins — VS Code registriert das Schema bei der Installation |
| Terminal | öffnet ein Terminal im Ordner und startet `claude` (`larvis://…`) | einmalig der Installer unten |
| Kopieren | legt `cd <pfad> && claude` in die Zwischenablage | keins |

Browser dürfen von einer `https://`-Seite nicht direkt `file://` öffnen. Deshalb
laufen beide Links über OS-URL-Schemata. Sie funktionieren nur auf dem Rechner,
auf dem die Ordner liegen; der Terminal-Handler unten ist für Linux-Desktops (xdg-open) gebaut.

### Claude-Code-Link aktivieren (einmalig)

```bash
bash scripts/install-larvis-handler.sh
```

Das registriert `larvis://` für diesen User (schreibt
`~/.local/share/applications/larvis-open.desktop` und setzt das MIME-Default).
Danach öffnet der Terminal-Button ein Terminalfenster im Projektordner mit
laufendem `claude`.

Test ohne Browser:

```bash
xdg-open 'larvis://open?path=/home/user/projects/larvis'
```

Entfernen:

```bash
bash scripts/install-larvis-handler.sh --uninstall
```

### Dateien

- `larvis-open` — der Handler: dekodiert den Pfad aus `larvis://open?path=…`,
  öffnet ein Terminal (gnome-terminal/konsole/xfce4-terminal/kitty/alacritty/…)
  und startet `claude`. Erkennt das Terminal automatisch; bei einem exotischen
  Terminal hier die Liste ergänzen.
- `install-larvis-handler.sh` — Registrierung des Schemas (mit `--uninstall`).

### VS Code statt Claude Code als Standard

Der VS-Code-Button reicht oft schon: Ordner öffnet sich in VS Code, dort
Claude Code per Tastenkürzel starten. Der `larvis://`-Handler ist nur nötig,
wenn du direkt im Terminal mit laufendem `claude` landen willst.
