# Skripte

Wartungs- und Pipeline-Skripte. Alle lesen ihre Zugangsdaten aus der root-`.env.local`
(`node --env-file=.env.local scripts/…`), mindestens `SUPABASE_URL` und
`SUPABASE_SERVICE_ROLE_KEY`.

| Ordner/Datei | Zweck |
|---|---|
| `contacts/` | Kontakte aus einem LinkedIn-Export (`import-linkedin.mjs`) oder einer vCard-Datei (`import-vcard.mjs`) importieren, danach Dubletten zusammenführen (`merge-duplicates.mjs`, abgelehnte Paare in `rejected-pairs.json`) |
| `learnweb/` | Learnweb-Sync lokal, Fixtures für die Parser-Tests holen, Vorlesungsvideos transkribieren (lokal mit faster-whisper oder über die OpenAI-API) |
| `memory/sync-claude-md.mjs` | Memories nach `~/.claude/globals/larvis-memories.md` schreiben (`npm run memory:sync`), damit Claude-Agenten sie über die globale `CLAUDE.md` im Kontext haben |
| `larvis-open`, `install-larvis-handler.sh` | `larvis://`-Links aus der App öffnen ein Terminal im Projektordner (unten) |

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
