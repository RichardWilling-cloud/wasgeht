# wasgeht — Erfurt geht raus

Statische Event-Website für Erfurt mit Supabase Auth, Eventdatenbank und Admin-Oberfläche.

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

Das Repository liegt unter <https://github.com/RichardWilling-cloud/wasgeht>.

1. Im Terminal in den Projektordner wechseln:

   ```sh
   cd "/Users/richardwilling/.copilot/chats/021713ba-51d7-48e1-88b0-097457016b16"
   ```

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

Das SQL-Schema enthält keinen Produktnamen; Accounts, Events und Rollen bleiben im bestehenden Supabase-Projekt erhalten. Der Kontaktlink auf der Website verwendet `hallo@wasgeht.de`; diese Mailbox muss eingerichtet oder im Footer auf eine bereits vorhandene Adresse geändert werden.

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

## Lokal testen

Die Seite sollte über einen lokalen HTTP-Server statt über `file://` geöffnet werden, damit Auth-Weiterleitungen funktionieren. Zum Beispiel:

```sh
python3 -m http.server 8000
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

3. `OPENAI_API_KEY` als Supabase Function Secret hinterlegen; `OPENAI_MODEL` ist optional und standardmäßig `gpt-6-luna`. `GOOGLE_SEARCH_API_KEY` (SerpAPI) aktiviert die Bildersuche als Rückfall, wenn auf der offiziellen Eventseite kein Bild gefunden wurde; das kann Such-API-Kosten verursachen. Website-Metadaten werden auch ohne diesen Schlüssel ausgewertet.
4. Für die eigenen Clubquellen den Inhalt von [`supabase/club-sources.sql`](./supabase/club-sources.sql) im Supabase SQL Editor ausführen. Das ergänzt `events.source_name`, deaktiviert alle bisherigen Erfurter Quellen und aktiviert ausschließlich die 13 ausgewählten Websites.
5. Im Admin-Bereich zuerst einen Dry-Run starten und die Ergebnisse sowie Quellenfehler in `public.import_runs` prüfen. Der Import verarbeitet höchstens acht Events je Anfrage und startet weitere Batches nach 60 Sekunden automatisch; der Website-Tab muss geöffnet bleiben. Über `Nach diesem Teil pausieren` kann nach dem aktuellen Batch angehalten werden. Dry-Runs und echte Importe haben getrennte, gespeicherte Batch-Zeiger. Die Schaltfläche `Importfortschritt zurücksetzen` löscht beide Zeiger; sie ist während des Imports und der automatischen Fortsetzung gesperrt. Anschließend `needs_review`-Einträge kontrollieren, bevor ein echter Import gestartet wird.
6. Die Website-Adapter lesen JSON-LD-Events und klar erkennbare Veranstaltungskarten aus; beliebige `<article>`-Elemente und allgemeine Akkordeons gelten nicht automatisch als Event. Für Kalif Storch, Triebwerk und den Jazzclub gibt es Kalenderadapter. Franz Mehlhose und Frau Korte werden über ihre datierten Programmblöcke ausgelesen; Jederkann und Retronom verwenden eng begrenzte Adapter für die explizit angekündigten Monats-/Wochentagstermine. Bild-URLs werden aus strukturierten Daten, `img`/`picture`-Tags und gängigen Lazy-Load-Attributen übernommen. Nicht belegte Outdoor-Kategorien werden auf eine neutrale Kategorie zurückgestuft. Seiten ohne auslesbare Veranstaltungskarten werden als Quellenfehler ausgewiesen, statt den gesamten Seitentext als vermeintliches Event einzureichen.

Die Function speichert Events ohne belastbares Datum oder Ort nicht als veröffentlicht. Sie sucht fehlende Bilder zuerst in Open-Graph-/Twitter-Metadaten und Event-JSON-LD der offiziellen Eventseite. Wenn dort kein Bild verfügbar ist und `GOOGLE_SEARCH_API_KEY` konfiguriert wurde, nutzt sie SerpAPI/Google Images mit Eventtitel und Veranstaltungsort; verwendet werden nur Treffer, deren verlinkte Seite zur offiziellen Website der Quelle gehört. Die Bilddateien bleiben externe URLs und werden nicht in Supabase kopiert; ob die Website sie ohne Hotlink-Schutz ausliefert, liegt außerhalb der Plattform. Der Import nutzt den angemeldeten Admin-JWT mit RLS, schützt Organizer-Events, speichert den Namen der Importquelle samt Event-URL und zeigt beides in der Admin- und Prüfliste an. Die Function protokolliert Quellenfehler und archiviert vergangene Events transaktional. Die SQL-Erweiterung plant zusätzlich eine tägliche Archivierung um 03:00 UTC mit `pg_cron`. Ein Dry-Run protokolliert den Lauf, verändert aber keine Events und archiviert nichts. Höchstens acht KI-Anfragen laufen je Import, um Edge-Laufzeit und OpenAI-Rate-Limits einzuhalten; Website-Quellen werden parallel abgerufen. Die Oberfläche setzt weitere Batches automatisch nach 60 Sekunden fort, hält bei wiederholtem Rate-Limit aber an.

Die serverseitige Implementierung lebt in [`supabase/functions/run-event-import/index.ts`](./supabase/functions/run-event-import/index.ts) und bildet den echten Admin-Import-Lauf ab; dort sind die modularen Quellenadapter, der Admin-Check und die Archivierung bereits integriert.
