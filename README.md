# wasgeht — Erfurt geht raus

Statische Event-Website für Erfurt mit Supabase Auth, Eventdatenbank und Admin-Oberfläche.

## Mobile-App für iOS und Android

Im Repository liegt zusätzlich eine Expo-/React-Native-App. Sie verwendet dieselbe Supabase-Instanz wie die Website und enthält:

- Eventübersicht mit Suche, Genre- und Umgebungsfilter
- Eventkarten mit Detailansicht und Bildern
- Login und Registrierung
- Einreichung eigener Events
- Admin-Übersicht mit Freigeben, Ausblenden und Löschen
- EAS-Konfiguration für interne Builds und Store-Builds

### SEO

Die Website enthält optimierte Meta- und Open-Graph-Daten, FAQ- und semantische Event-Markups für veröffentlichte öffentliche Events sowie crawlbare Inhalte zu Veranstaltungen in Erfurt. Der GitHub-Pages-Workflow erzeugt zusätzlich Landingpages für Erfurt, Raves, Konzerte, Szene-Events, ruhige Veranstaltungen und das Wochenende. `robots.txt` verweist auf die automatisch aktualisierte `sitemap.xml`; beide Dateien müssen beim Hosting unter der Domain-Wurzel veröffentlicht werden. Private oder nicht veröffentlichte Events werden dabei niemals ausgegeben.

### Lokal starten

Node.js und npm installieren, anschließend:

```sh
npm install
npx expo start
```

Für einen echten Gerätestart:

```sh
npx expo run:ios
npx expo run:android
```

Die Expo-Umgebungsvariablen stehen in [`.env.example`](./.env.example). Der öffentliche Supabase-Key darf in der App verwendet werden; niemals einen `service_role`-Key eintragen.

### Store-Builds

```sh
npx eas login
npx eas build:configure
npx eas build --platform all --profile production
npx eas submit --platform ios --profile production
npx eas submit --platform android --profile production
```

Starter-App-Icon und Splashscreen liegen unter [`assets/`](./assets/) und sind in der Expo-Konfiguration aktiviert. Vor dem Store-Build sollten sie durch die finalen Brand-Assets ersetzt, Apple-/Google-Entwicklerkonten verbunden, Datenschutz-/Impressumsseiten hinterlegt und die Store-Metadaten ausgefüllt werden. Die Bundle-ID ist `de.wasgeht.app` für iOS und Android.

Für die Einreichung eigener Events muss der aktualisierte Abschnitt aus [`supabase-schema.sql`](./supabase-schema.sql) einmal im Supabase SQL Editor ausgeführt werden. Er ergänzt `created_by` und erlaubt ausschließlich authentifizierten Nutzern, private Organizer-Events zur Prüfung einzureichen.

## Voraussetzungen

- Ein Supabase-Projekt
- Ein GitHub-Konto
- Git auf dem eigenen Rechner

Die `sb_publishable_...`-Kennung in `index.html` ist der öffentliche Supabase-Client-Key. Sie darf im Browser verwendet werden. Niemals einen `service_role`-Key oder ein Passwort in die Website oder ins Repository eintragen. Der Datenzugriff wird mit Row-Level Security im Supabase-Schema abgesichert.

## Supabase vorbereiten

1. Supabase öffnen und **SQL Editor → New query** wählen.
2. Den vollständigen Inhalt von [`supabase-schema.sql`](./supabase-schema.sql) einfügen und ausführen.
3. Auf der Website einen Account registrieren und gegebenenfalls die Bestätigungs-E-Mail öffnen.
4. Die E-Mail als Administrator freischalten. `DEINE_EMAIL_ADRESSE` ersetzen:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'DEINE_EMAIL_ADRESSE';
   ```

5. Unter **Authentication → URL Configuration** später die veröffentlichte Website-Adresse als **Site URL** sowie als zusätzliche Redirect URL eintragen. Siehe GitHub-Pages-Abschnitt unten.

## Vorhandenes GitHub-Repository verbinden und veröffentlichen

Die Website wird bei jedem Push auf `main` automatisch mit GitHub Actions auf GitHub Pages veröffentlicht.
In der schmalen Statuszeile am oberen Rand zeigt `Live · Datum · #Laufnummer` die veröffentlichte Website-Version. Der zugehörige Commit ist beim Darüberfahren sichtbar. Eine lokale oder noch nicht veröffentlichte Kopie wird stattdessen als `Lokal · nicht veröffentlicht` markiert.

Der GitHub-Pages-Workflow führt vor jedem Deployment die Unit-Tests aus und erzeugt statische SEO-Seiten für alle öffentlichen, veröffentlichten Events unter `/event/.../`. Er läuft automatisch täglich um 03:30 UTC, also nach dem nächtlichen Import und der Archivierung, und aktualisiert dabei auch `sitemap.xml`. Neue Events werden dadurch ohne manuellen Deploy in die Suchmaschinen-Seiten aufgenommen.

Eventvorschläge werden nur von angemeldeten Accounts angenommen, auf fünf Vorschläge je 24 Stunden begrenzt und erst nach Admin-Prüfung veröffentlicht. Für E-Mail-Benachrichtigungen die Function `notify-event-suggestion` mit `RESEND_API_KEY`, `EVENT_SUGGESTION_RECIPIENT` und `EVENT_SUGGESTION_SENDER` als Function Secrets deployen. Die Absenderdomain muss zuvor bei Resend verifiziert werden.

Der Quellenadapter für [Campus Erfurt](https://www.campus-erfurt.de/veranstaltungskalender1) ruft den clientseitig eingebundenen ThüCAT-Kalender serverseitig ab und fasst die einzelnen Termine einer Ausstellung zu einem Event mit Zeitraum zusammen. Bei inhaltlich gleichen Events bleibt die spezifischere Originalquelle bevorzugt; Campus Erfurt dient als zusätzliche Auffangquelle. Die Quelle ist derzeit **deaktiviert**, weil sie zu viele unpassende Events lieferte. Der Adapter bleibt im Code; reaktivieren lässt sie sich mit [`supabase/add-campus-erfurt-source.sql`](./supabase/add-campus-erfurt-source.sql) bzw. `update public.sources set is_active = true where source_name = 'Campus Erfurt';`.

Das Repository liegt unter <https://github.com/RichardWilling-cloud/wasgeht>.

1. Im Terminal in den Projektordner wechseln.

2. GitHub CLI installieren, falls `gh` noch nicht vorhanden ist. Auf dem Mac mit Homebrew:

   ```sh
   brew install gh
   ```

3. GitHub CLI im Browser anmelden und Git dafür einrichten:

   ```sh
   gh auth login --hostname github.com --git-protocol https --web
   gh auth setup-git
   ```

   Folge dem angezeigten Browser-/Gerätecode-Anmeldeschritt im Terminal. Teile den Code, ein Passwort oder einen Token nicht im Chat.

4. Das lokale Repository ist bereits mit `origin` verbunden. Jetzt den Branch veröffentlichen:

   ```sh
   git push -u origin main
   ```

5. Im GitHub-Repository **Settings → Pages** öffnen. Als Build and deployment source **GitHub Actions** wählen. Falls der Workflow bereits läuft, den Lauf unter **Actions** prüfen; bei Bedarf einmal **Run workflow** ausführen.
6. Die Website ist üblicherweise unter dieser Adresse erreichbar:

   ```text
   https://richardwilling-cloud.github.io/wasgeht/
   ```

7. Diese exakte URL anschließend in Supabase unter **Authentication → URL Configuration** als **Site URL** eintragen und unter **Redirect URLs** hinzufügen. Danach eine neue Bestätigungs-E-Mail anfordern. Bereits versandte Bestätigungslinks können abgelaufen sein oder noch die alte Weiterleitungsadresse enthalten.

## Nach der Umbenennung zu „wasgeht“

Die veröffentlichte Adresse lautet jetzt:

```text
https://richardwilling-cloud.github.io/wasgeht/
```

In Supabase müssen die Auth-Einstellungen ebenfalls auf diese Adresse umgestellt werden:

1. **Authentication → URL Configuration** öffnen.
2. **Site URL** auf die neue Adresse setzen und sie unter **Redirect URLs** eintragen.
3. Unter **Authentication → Email Templates** den Produktnamen in den E-Mail-Vorlagen aktualisieren.
4. Optional unter **Project Settings → General** den angezeigten Projektnamen auf `wasgeht` ändern. Die Projekt-Referenz und URL in `index.html` nicht ändern: Dafür ist keine Datenbankmigration nötig.

Das SQL-Schema enthält keinen Produktnamen; Accounts, Events und Rollen bleiben im bestehenden Supabase-Projekt erhalten. Der Kontaktlink auf der Website verwendet `waslos@wasgeht-ab.de`.

## Eigene Domain: wasgeht-ab.de

Die Root-Datei [`CNAME`](./CNAME) hält die gewünschte Domain-Zuordnung für Deployments fest. GitHub Pages kann das TLS-Zertifikat erst ausstellen, wenn die DNS-Einträge auf GitHub zeigen. Damit die Domain erreichbar ist:

1. Beim DNS-Anbieter die bisherigen Web-A-/AAAA-Einträge für `@` entfernen und diese vier A-Einträge setzen:

   ```text
   @  A  185.199.108.153
   @  A  185.199.109.153
   @  A  185.199.110.153
   @  A  185.199.111.153
   ```

2. Optional `www` als CNAME auf `RichardWilling-cloud.github.io` setzen. Die Root-Domain `wasgeht-ab.de` bleibt die Hauptadresse.
3. Nach der DNS-Propagation unter **Repository → Settings → Pages** prüfen, dass `wasgeht-ab.de` als Custom domain angezeigt wird und HTTPS aktiviert werden kann. GitHub stellt das TLS-Zertifikat nach erfolgreicher DNS-Prüfung bereit.
4. In Supabase unter **Authentication → URL Configuration** die **Site URL** auf `https://wasgeht-ab.de` ändern und `https://wasgeht-ab.de/**` unter **Redirect URLs** ergänzen. Optional zusätzlich `https://www.wasgeht-ab.de/**` erlauben, falls `www` verwendet wird.

Die DNS-Propagation kann je nach Anbieter einige Stunden dauern. Bis dahin bleibt die GitHub-Pages-Adresse verfügbar.

## Website-Build

`scripts/build-site.mjs` baut die veröffentlichte Website nach `_site/`. Nur dort liegende Dateien gehen online – Schema, Edge Functions, App-Quellcode und README werden nicht mehr ausgeliefert. Der Build

- rendert die ersten 12 aktuellen Events direkt in `index.html` (sofort sichtbar und für Suchmaschinen crawlbar, Titel verlinken auf die Eventseiten),
- erzeugt `/event/<slug>/`, `/erfurt/` und die Genre-/Wochenend-Landingpages,
- schreibt `sitemap.xml` (mit echtem `lastmod`) und `robots.txt`,
- bricht ab, solange Impressum oder Datenschutzerklärung noch `[[AUSFÜLLEN …]]`-Platzhalter enthalten.

Die Startseite lädt die Events direkt über die REST-API. Das Supabase-SDK (`vendor/`, selbst gehostet und versioniert) wird erst nachgeladen, wenn jemand angemeldet ist oder sich anmelden möchte. Die Content-Security-Policy steht als `<meta>` in `index.html`. Wird das kleine Inline-Skript im `<head>` geändert, muss dessen SHA-256-Hash in der CSP aktualisiert werden.

Für das SDK-Update: `npm install`, danach `node_modules/@supabase/supabase-js/dist/umd/supabase.js` als `vendor/supabase-js-<version>.js` kopieren und `SUPABASE_SDK_URL` in `app.js` anpassen.

## Lokal testen

```sh
ALLOW_PLACEHOLDERS=1 SUPABASE_URL=https://zvhvofgpizwhtxmcnghm.supabase.co \
  SUPABASE_PUBLISHABLE_KEY=sb_publishable_8tGj45KNbpGERTyOtC2Cfg_IiFh9myI \
  node scripts/build-site.mjs
cd _site && python3 -m http.server 8000
```

Dann `http://localhost:8000/` im Browser aufrufen und diese Adresse während des lokalen Tests zusätzlich in Supabase als Redirect URL eintragen.

## KI-Event-Import

Das Projekt enthält jetzt die Datenmodell- und Logik-Basis für einen Admin-Importlauf mit dem Namen `runEventImport`.

- Die aktive Eventtabelle wurde um Felder wie `category`, `origin`, `confidence`, `status`, `source_type`, `content_hash`, `city`, `source_url` und `last_seen_at` erweitert.
- `events_archive` sammelt veraltete Einträge, `sources` hält konfigurierbare Quellen für Erfurt fest, und `import_runs` protokolliert jeden Lauf mit Fehlern und Statistiken.
- Für die Matching-/Archivierungslogik gibt es eine testbare JavaScript-Implementierung in [`event-import.js`](./event-import.js), samt Unit-Tests unter [`tests/event-import.test.js`](./tests/event-import.test.js).
- In der Admin-Oberfläche kann ein `KI-Import starten`-Button ein Dry-Run oder einen echten Lauf auslösen; die Funktion prüft Admin-Rechte serverseitig und verwaltet die Ergebnis-Zusammenfassung.
- Eventbilder werden beim Import aus Eventkarten oder Event-Metadaten übernommen, sofern die Quelle sie bereitstellt. Bilder lassen sich außerdem über eine optionale Bild-URL in der Eventverwaltung ergänzen. Fehlt ein Bild oder kann es nicht geladen werden, zeigt die Karte stattdessen ein gestaltetes Textposter.

### Konfiguration

Für den Edge Function Import ist `OPENAI_API_KEY` als Supabase Function Secret erforderlich. `GOOGLE_SEARCH_API_KEY` (SerpAPI) ermöglicht Google-Websuche für konfigurierte Suchquellen und die Bildsuche als Rückfall. Supabase-REST-Aufrufe laufen mit dem angemeldeten Admin-JWT und der Publishable-/Anon-Key-Konfiguration; ein service-role/secret key wird von der Function nicht benötigt.

Lokale Variablen sind in `.env.example` dokumentiert. Diese Datei ist nur eine Vorlage und wird nicht automatisch von Supabase Edge Functions geladen.

### Ablauf für den echten Import

1. In Supabase die SQL-Erweiterungen aus `supabase-schema.sql` einspielen.
2. Die Edge Function deployen:

   ```bash
   supabase functions deploy run-event-import --remote=zvhvofgpizwhtxmcnghm --use-api --yes
   ```

3. `OPENAI_API_KEY` und `CRON_IMPORT_SECRET` als Supabase Function Secrets hinterlegen; `OPENAI_MODEL` ist optional und standardmäßig `gpt-6-luna`. Ein Secret erzeugst du z. B. mit `openssl rand -hex 32`; denselben Wert als Function Secret `CRON_IMPORT_SECRET` und als Vault-Secret `wasgeht-cron-import-secret` speichern. Den Wert niemals committen oder in die Website eintragen. `GOOGLE_SEARCH_API_KEY` (SerpAPI) aktiviert die Bildersuche als Rückfall, wenn auf der offiziellen Eventseite kein Bild gefunden wurde; das kann Such-API-Kosten verursachen. Website-Metadaten werden auch ohne diesen Schlüssel ausgewertet.
4. Für das vollständige Quellen-Setup den Inhalt von [`supabase/club-sources.sql`](./supabase/club-sources.sql) im Supabase SQL Editor ausführen. Das ergänzt `events.source_name`, deaktiviert alle bisherigen Erfurter Quellen und aktiviert ausschließlich die ausgewählten Club- und Veranstalter-Websites (ohne Campus Erfurt). Wenn nur Planet Comics Cafe zusätzlich aufgenommen werden soll, stattdessen [`supabase/add-planet-comics-source.sql`](./supabase/add-planet-comics-source.sql) ausführen; dieses Script verändert keine bestehenden Quellen.
5. Der SQL-Teil richtet zusätzlich einen täglichen Import um 02:00 Uhr Europe/Berlin ein. Zwei UTC-Zeitpläne decken Sommer- und Winterzeit ab; die Funktion führt nur den Lauf aus, dessen Berliner Stunde tatsächlich 02 ist. Der Lauf verarbeitet alle Batches, archiviert vergangene Events und protokolliert jeden Batch in `public.import_runs`. Prüfe einmal täglich die `needs_review`-Einträge. Für einen ersten manuellen Test im Admin-Bereich weiterhin zuerst einen Dry-Run starten; manuelle Importe verarbeiten höchstens acht Events je Anfrage und setzen weitere Batches nach 60 Sekunden fort. Für Eventkandidaten werden ausschließlich aktive `website`-Quellen aus `public.sources` geladen; Google/SerpAPI bleibt ein optionaler Bilder-Rückfall und liefert keine Events.
6. Die Website-Adapter lesen JSON-LD-Events und klar erkennbare Veranstaltungskarten aus; beliebige `<article>`-Elemente und allgemeine Akkordeons gelten nicht automatisch als Event. Für Kalif Storch, Triebwerk und den Jazzclub gibt es Kalenderadapter. Franz Mehlhose und Frau Korte werden über ihre datierten Programmblöcke ausgelesen; Jederkann und Retronom verwenden eng begrenzte Adapter für die explizit angekündigten Monats-/Wochentagstermine. Bild-URLs werden aus strukturierten Daten, `img`/`picture`-Tags und gängigen Lazy-Load-Attributen übernommen. Nicht belegte Outdoor-Kategorien werden auf eine neutrale Kategorie zurückgestuft. Seiten ohne auslesbare Veranstaltungskarten werden als Quellenfehler ausgewiesen, statt den gesamten Seitentext als vermeintliches Event einzureichen.

Die Function speichert Events ohne belastbares Datum oder Ort nicht als veröffentlicht. Sie sucht fehlende Bilder zuerst in Open-Graph-/Twitter-Metadaten und Event-JSON-LD der offiziellen Eventseite. Wenn dort kein Bild verfügbar ist und `GOOGLE_SEARCH_API_KEY` konfiguriert wurde, nutzt sie SerpAPI/Google Images mit Eventtitel und Veranstaltungsort; verwendet werden nur Treffer, deren verlinkte Seite zur offiziellen Website der Quelle gehört. Die Bilddateien bleiben externe URLs und werden nicht in Supabase kopiert; ob die Website sie ohne Hotlink-Schutz ausliefert, liegt außerhalb der Plattform. Der Import nutzt den angemeldeten Admin-JWT mit RLS, schützt Organizer-Events, speichert den Namen der Importquelle samt Event-URL und zeigt beides in der Admin- und Prüfliste an. Die Function protokolliert Quellenfehler und archiviert vergangene Events transaktional. Die SQL-Erweiterung richtet zusätzlich einen täglichen Import um 02:00 Uhr Europe/Berlin mit `pg_cron` ein, der alle Batches verarbeitet und vergangene Events archiviert. Ein Dry-Run protokolliert den Lauf, verändert aber keine Events und archiviert nichts. Höchstens acht KI-Anfragen laufen je Batch, um Edge-Laufzeit und OpenAI-Rate-Limits einzuhalten; Website-Quellen werden parallel abgerufen. Die Oberfläche setzt manuelle weitere Batches automatisch nach 60 Sekunden fort, hält bei wiederholtem Rate-Limit aber an.

### Automatisches Aufräumen

Nach dem letzten Paket jedes vollständigen Imports (nicht im Testlauf) prüft `runMaintenance` den gesamten Bestand **automatisch importierter** Events (`origin = 'ai'`; manuell angelegte Events und Nutzer-Einreichungen bleiben unberührt):

- Events deaktivierter Quellen werden gelöscht,
- Fußball- und rechtsextreme Events (Inhaltsfilter) werden gelöscht,
- Einträge der Prüfliste, die seit 2 Tagen in keiner Quelle mehr auftauchen, werden gelöscht,
- Duplikate (gleiche Location, Beginn innerhalb von 90 Minuten, gleiche Kernwörter im Titel) werden zusammengeführt – behalten wird die Version mit Bild und längerer Beschreibung; nummerierte Vorstellungen („2. Show“) bleiben getrennt,
- Location-Namen werden vereinheitlicht (`VENUE_ALIASES`), Gaming/Kartenspiele/LARP & Co. landen unter „Szene & Nerd“.

Das Ergebnis steht in den Function-Logs („Import maintenance“) und als Hinweis im Ergebnis des letzten Import-Pakets.

Die serverseitige Implementierung lebt in [`supabase/functions/run-event-import/index.ts`](./supabase/functions/run-event-import/index.ts) und bildet den echten Admin-Import-Lauf ab; dort sind die modularen Quellenadapter, der Admin-Check und die Archivierung bereits integriert.
