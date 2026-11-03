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

## Eigene Domain

Optional kann unter **Repository → Settings → Pages → Custom domain** eine eigene Domain wie `events.example.de` eingetragen werden. Die Domain muss beim DNS-Anbieter mit den von GitHub Pages angegebenen DNS-Einträgen verknüpft werden. Danach in Supabase dieselbe `https://`-Adresse als Site URL und Redirect URL setzen.

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

### Konfiguration

Für den Edge Function Import ist `OPENAI_API_KEY` als Supabase Function Secret erforderlich. Optional ermöglicht `GOOGLE_SEARCH_API_KEY` Websuche über SerpAPI. Supabase-REST-Aufrufe laufen mit dem angemeldeten Admin-JWT und der Publishable-/Anon-Key-Konfiguration; ein service-role/secret key wird von der Function nicht benötigt.

Lokale Variablen sind in `.env.example` dokumentiert. Diese Datei ist nur eine Vorlage und wird nicht automatisch von Supabase Edge Functions geladen.

### Ablauf für den echten Import

1. In Supabase die SQL-Erweiterungen aus `supabase-schema.sql` einspielen.
2. Die Edge Function deployen:

   ```bash
   supabase functions deploy run-event-import --project-ref zvhvofgpizwhtxmcnghm
   ```

3. `OPENAI_API_KEY` als Supabase Function Secret hinterlegen; `OPENAI_MODEL` ist optional und standardmäßig `gpt-4o-mini`. Ein Google-Search-Secret wird nur benötigt, wenn eine Google-Quelle aktiviert ist.
4. Im Admin-Bereich auf `KI-Import starten` klicken.
5. Quelle(n) in `public.sources` aktivieren und `city = 'Erfurt'` setzen.
6. Die Website-Adapter lesen strukturierte Eventdaten aus JSON-LD oder reichen Seitentext zur Extraktion weiter. Die Google-Quelle benötigt SerpAPI; Instagram bleibt bis zur offiziellen API-/Textanbindung deaktiviert.
7. Die Ergebnisse und Quellenfehler in `public.import_runs` überwachen und `needs_review`-Einträge im Admin-Dialog prüfen.

Die Function speichert Events ohne belastbares Datum oder Ort nicht als veröffentlicht. Sie nutzt den angemeldeten Admin-JWT mit RLS, schützt Organizer-Events, protokolliert Quellenfehler und archiviert vergangene Events transaktional. Die SQL-Erweiterung plant zusätzlich eine tägliche Archivierung um 03:00 UTC mit `pg_cron`. Ein Dry-Run protokolliert den Lauf, verändert aber keine Events und archiviert nichts.

Die serverseitige Implementierung lebt in [`supabase/functions/run-event-import/index.js`](./supabase/functions/run-event-import/index.js) und bildet den echten Admin-Import-Lauf ab; dort sind die modularen Quellenadapter, der Admin-Check und die Archivierung bereits integriert.
