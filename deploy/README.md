# Eigenbetrieb auf einem eigenen Server

Larvis lässt sich auf einem einzelnen Linux-Server mit Docker betreiben: ein zentraler Caddy
auf 80/443, dahinter der App-Container am Docker-Netz `web`. Datenbank, Auth, Storage und der
Minuten-Cron laufen in einer eigenen, selbst gehosteten Supabase daneben (`/opt/supabase`,
Stack `larvis-supabase`, Postgres-Container `larvis-db`, unter derselben Domain als
Pfad-Präfixe, Keys in `/opt/supabase/.env`); der App-Container hält keinen Zustand und ist
jederzeit neu baubar.

Die Pfade unten sind eine Konvention, keine Pflicht.

| Ort auf dem Server | Inhalt |
|---|---|
| `/opt/larvis/docker-compose.yml` | aus `deploy/docker-compose.prod.yml`, kommt mit jedem Deploy |
| `/opt/larvis/.env` | Server-Secrets plus `LARVIS_IMAGE`, `APP_TAG`/`APP_TAG_VORHER`, Modus 600 |
| `/opt/supabase/docker-compose.yml` | aus `deploy/supabase/docker-compose.yml` (plus `init/`) |
| `/opt/proxy/Caddyfile` | enthält den Site-Block aus `deploy/Caddyfile.larvis` |

## Wie die API-Handler laufen

Die App ist eine Vite-SPA plus API-Handler unter `apps/web/api/`, die als ein
Node-Server laufen:

- `apps/web/scripts/build-api.mjs` bündelt jeden Handler mit esbuild nach
  `apps/web/dist-api/`. Extern bleiben dieselben Pakete wie in den vorhandenen
  `_lib`-Bundles, plus `web-push`.
- `apps/web/server/index.mjs` liefert `dist/` aus, leitet `/api/*` an das passende
  Bundle weiter und legt `status`/`json`/`send`/`redirect` sowie `query` und `body`
  auf die Node-Objekte. Zwei Handler (`mcp`, `oauth-protected-resource`) sprechen
  direkt mit `IncomingMessage` und `ServerResponse`; deshalb wird das native Objekt
  erweitert statt ersetzt. Der Server bedient außerdem
  `/.well-known/oauth-protected-resource` am Domain-Root mit dem Handler
  `oauth-protected-resource` und liefert für Client-Routen `index.html` aus
  (SPA-Fallback). Request-Bodys nimmt er bis 25 MB an.

## Deploy

Der Workflow `.github/workflows/release.yml` baut das Image in GitHub Actions, legt es in der
Registry ab, die die Repository-Variable `APP_IMAGE` nennt (Tags `latest` und
`sha-<commit>`), und rollt es per SSH auf den Server: Compose-Datei kopieren, Image ziehen,
`docker compose up -d`, Health-Check gegen `<APP_URL>/healthz`, danach `APP_TAG` in `.env`
nachziehen. Vorher laufen die Prüfungen aus `ci.yml`; ein roter Stand wird weder gebaut noch
ausgerollt. Der Workflow startet von Hand; welche Variablen und Secrets er braucht, steht in
seinem Kopf.

Auf dem Server liegt kein Quellbaum und läuft kein Build. Der Deploy-Benutzer ist in der
Gruppe `docker`, sein öffentlicher Schlüssel steht in dessen `~/.ssh/authorized_keys`; der
private Teil ist das Repository-Secret `DEPLOY_SSH_KEY`, dazu `DEPLOY_HOST`, `DEPLOY_USER`
und `DEPLOY_KNOWN_HOSTS`. Die öffentliche Client-Konfiguration des Images
(`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`) sind
Repository-Variablen. Ort und Module (`VITE_WEATHER_*`, `VITE_HOME_PLACE`,
`VITE_LEARNWEB_ENABLED`, `VITE_MENSA_CANTEENS`) stehen ebenfalls als Repository-Variablen fest
im Image, für die Web-App wie für API und Remote-MCP; ein Wert ohne `VITE_`-Präfix in
`/opt/larvis/.env` (etwa `LEARNWEB_ENABLED=1`) hat serverseitig Vorrang, die Web-App sieht
weiter den Wert aus dem Image.

Rollback: in `/opt/larvis/.env` steht unter `APP_TAG_VORHER` der Stand davor.
Ihn in `APP_TAG` eintragen und `docker compose up -d`; das Image liegt noch in
der Registry und meist noch auf der Box. Ein gescheiterter Deploy schreibt die
`.env` nicht, dort steht dann weiter der laufende Stand, und `docker compose up -d`
allein stellt ihn wieder her.

Betrieb: `docker compose logs -f larvis` zeigt das Log, `curl
http://127.0.0.1:3001/healthz` prüft von innen. Port 3001 ist an den Loopback
gebunden; von außen führt der Weg ausschließlich über Caddy.

## Domain anbinden

1. A-Record der Domain auf die Server-IP.
2. `deploy/Caddyfile.larvis` an `/opt/proxy/Caddyfile` anhängen, `LARVIS_DOMAIN` in
   `/opt/proxy/.env` setzen und in der `environment`-Liste des Caddy-Service
   ergänzen, dann `docker compose -f /opt/proxy/docker-compose.yml up -d`.
3. In `/opt/supabase/.env` `API_EXTERNAL_URL`, `SITE_URL` und
   `ADDITIONAL_REDIRECT_URLS` auf die Domain stellen, dann
   `docker compose -f /opt/supabase/docker-compose.yml up -d` (Login-Mails und
   OAuth-Consent hängen daran). Die Repository-Variable `VITE_SUPABASE_URL` zieht
   mit, sonst baut die Pipeline den Client gegen eine falsche Domain.
4. Google Cloud Console → OAuth-Client: `https://<domain>/api/google/oauth-callback`
   als Redirect-URI eintragen, danach `GOOGLE_REDIRECT_URI` in `/opt/larvis/.env`
   setzen.
5. Für den Remote-MCP-Connector auf claude.ai die URL `https://<domain>/api/mcp`
   eintragen; `MCP_RESOURCE_URL` in der `.env` auf dieselbe URL setzen, wenn
   Audience-Binding aktiv sein soll. Die Funktion `mcp_access_token_hook` in der
   Basis-Migration enthält dafür eine Platzhalter-URL, die genau diesem Wert entsprechen muss.
6. Der Minuten-Cron für Push-Benachrichtigungen lebt als pg_cron-Job in Supabase und
   ruft die URL aus dem Vault-Secret `reminder_tick_url`. Die Basis-Migration legt das
   Secret mit einer Platzhalter-Adresse an; es wird per
   `select vault.update_secret((select id from vault.secrets where name = 'reminder_tick_url'), 'https://<domain>/api/notifications/tick');`
   auf die eigene Domain gestellt. Das Cron-Secret (`reminder_cron_secret`) erzeugt die
   Migration zufällig in der Datenbank; es liegt nur im Vault und gehört nicht in die `.env`.

## Schema einspielen

Das ganze Schema steht in einer Migration, `supabase/migrations/20260101000000_basis.sql`
(Tabellen, RLS, Storage-Buckets, Realtime, Minuten-Cron, Access-Token-Hook). Auf dem Server
liegt kein Quellbaum; die Datei wird einmal nach dem ersten Start des Supabase-Stacks vom
eigenen Rechner aus eingespielt, wenn Storage seine eigenen Tabellen angelegt hat:

```
ssh <server> docker exec -i larvis-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < supabase/migrations/20260101000000_basis.sql
```

Vorher die Platzhalter-URL in `mcp_access_token_hook` auf die eigene Domain stellen (siehe
oben). Spätere Schema-Änderungen kommen als weitere Datei in `supabase/migrations/` und werden
genauso eingespielt.

## Konto anlegen

Die Registrierung ist aus (`GOTRUE_DISABLE_SIGNUP`). Das eine Konto wird über die
Admin-API von Supabase Auth angelegt, etwa mit dem Service-Role-Key:

```
curl -X POST "https://<domain>/auth/v1/admin/users" \
  -H "apikey: <SERVICE_ROLE_KEY>" -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"du@example.com","password":"…","email_confirm":true}'
```

Das älteste Konto in `auth.users` ist der Owner (`public.is_owner()`); seine UUID gehört
zusätzlich als `LARVIS_OWNER_ID` in `/opt/larvis/.env`.

## Anmeldung und Mailversand

Angemeldet wird per Passwort oder per 6-stelligem Code aus einer Mail; Standard auf
der Login-Seite ist der Code. Er gilt 10 Minuten, frühestens alle 30 Sekunden lässt
sich ein neuer anfordern, und nur für ein bestehendes Konto (Registrierung ist aus).
Der Code wird in der App eingetippt, deshalb bleibt die Anmeldung auch in der
installierten iPhone-App, statt wie ein Magic Link in Safari zu landen.

Die Mails verschickt der Auth-Dienst (GoTrue) über einen SMTP-Dienst deiner Wahl (Standard
Port 587 mit STARTTLS; manche Cloud-Anbieter sperren ausgehend die Ports 25 und 465). Absender
ist „Larvis" mit einer Adresse auf einer beim Dienst verifizierten eigenen Domain. Die
Konfiguration steht im Service `auth` in `deploy/supabase/docker-compose.yml`; die Werte kommen
aus `/opt/supabase/.env`:

| Variable | Inhalt |
|---|---|
| `SMTP_HOST` | Host des SMTP-Dienstes |
| `SMTP_PORT` | optional, Standard 587 |
| `SMTP_USER` | Benutzername beim SMTP-Dienst |
| `SMTP_PASS` | Passwort bzw. API-Key des SMTP-Dienstes |
| `SMTP_ADMIN_EMAIL` | Absenderadresse auf der verifizierten Domain |

Die Mailvorlage liegt als `apps/web/public/mail/magic-link.html` in der App. Vite
kopiert sie unverändert nach `dist/`, der App-Container liefert sie unter
`/mail/magic-link.html` aus, und GoTrue holt sie sich über das Docker-Netz `web` von
`http://larvis:3000/mail/magic-link.html`. Eine Änderung an der Vorlage heißt deshalb:
App neu bauen und deployen. GoTrue hält die geladene Vorlage bis zu 10 Minuten im
Speicher; ist die App beim ersten Versand nicht erreichbar, verschickt GoTrue
vorübergehend seine eingebaute Vorlage mit Link statt Code.

## Push-Benachrichtigungen

Push braucht ein eigenes VAPID-Schlüsselpaar (`npx web-push generate-vapid-keys`):
`VAPID_PRIVATE_KEY` und `VAPID_PUBLIC_KEY` in `/opt/larvis/.env`, der öffentliche Teil
zusätzlich als `VITE_VAPID_PUBLIC_KEY` im Image, dazu `VAPID_SUBJECT`
(`mailto:<deine-adresse>`). Ohne die Schlüssel antworten Tick und Test-Push mit 500.

## iOS-Kurzbefehl „In den Dump"

Der Kurzbefehl im Teilen-Menü des iPhones legt einen Link oder Text in den Dump (Tabelle
`inbox`) und nimmt dazu optional einen eigenen Kommentar mit: warum der Fund aufgehoben
wird und was daran wichtig ist. Claude übernimmt diesen Kommentar beim Einsortieren wörtlich
in den Eintrag; dort ist er Teil der Volltextsuche.

Er schickt an `https://<domain>/api/shortcuts/inbox` mit dem Token aus
`SHORTCUT_INBOX_TOKEN` in `/opt/larvis/.env`.

Anfrage:

```
POST https://<domain>/api/shortcuts/inbox
Authorization: Bearer <SHORTCUT_INBOX_TOKEN>
Content-Type: application/json

{ "content": "https://example.com/rezept", "note": "zum Nachkochen am Wochenende" }
```

- `content` ist Pflicht (Link oder Text, höchstens 20 000 Zeichen).
- `note` ist optional (höchstens 4 000 Zeichen); leer oder weggelassen heißt: kein
  Kommentar.
- Antwort `200 {"ok": true, "id": "…"}`; `400` ohne `content`, `401` bei falschem Token,
  `413` bei zu langem Text.

Den Kurzbefehl in der App „Kurzbefehle" bauen:

1. Neuer Kurzbefehl, in den Details „Im Share-Sheet anzeigen" einschalten und als
   Eingabe „URLs" und „Text" erlauben. Name z. B. „In den Dump".
2. Aktion „Nach Eingabe fragen": Typ Text, Frage „Warum speicherst du das?", Standardwert
   leer. Ohne Kommentar das Feld leer lassen und „Fertig" tippen, nie „Abbrechen" —
   Abbrechen beendet den Kurzbefehl.
3. Aktion „Inhalte von URL abrufen" mit der URL `https://<domain>/api/shortcuts/inbox`:
   Methode POST, Header `Authorization` mit dem Wert `Bearer <Token>`, Anfragetext JSON
   mit zwei Text-Feldern — `content` = Kurzbefehleingabe, `note` = Angegebene Eingabe aus
   Schritt 2.
4. Optional „Mitteilung anzeigen" mit „Im Dump", damit klar ist, dass es angekommen ist.
