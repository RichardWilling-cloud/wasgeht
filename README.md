# WOANDERS — Erfurt geht raus

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

## GitHub-Repository erstellen und veröffentlichen

Die Website wird bei jedem Push auf `main` automatisch mit GitHub Actions auf GitHub Pages veröffentlicht.

1. Auf GitHub **New repository** erstellen, zum Beispiel `woanders-erfurt`. Das Repository leer anlegen: kein README, keine Lizenz und kein `.gitignore` hinzufügen. Für kostenlose GitHub-Pages-Veröffentlichung das Repository öffentlich anlegen.
2. Im Terminal in den Projektordner wechseln:

   ```sh
   cd "/Users/richardwilling/.copilot/chats/021713ba-51d7-48e1-88b0-097457016b16"
   ```

3. Das lokale Repository erstmalig committen (falls dies noch nicht erledigt ist):

   ```sh
   git init -b main
   git add index.html supabase-schema.sql README.md .gitignore .github/workflows/pages.yml
   git commit -m "Initial WOANDERS website"
   ```

4. `DEIN-GITHUB-NAME` durch deinen GitHub-Benutzernamen oder deine Organisation ersetzen und das leere Repository verbinden:

   ```sh
   git remote add origin https://github.com/DEIN-GITHUB-NAME/woanders-erfurt.git
   git push -u origin main
   ```

   GitHub öffnet bei Bedarf seinen Anmeldedialog für Git Credential Manager. Kein Passwort oder Token in den Befehl schreiben.

5. Im GitHub-Repository **Settings → Pages** öffnen. Als Build and deployment source **GitHub Actions** wählen. Falls der Workflow bereits läuft, den Lauf unter **Actions** prüfen; bei Bedarf einmal **Run workflow** ausführen.
6. Die Website ist üblicherweise unter dieser Adresse erreichbar:

   ```text
   https://DEIN-GITHUB-NAME.github.io/woanders-erfurt/
   ```

7. Diese exakte URL anschließend in Supabase unter **Authentication → URL Configuration** als **Site URL** eintragen und unter **Redirect URLs** hinzufügen. Danach eine neue Bestätigungs-E-Mail anfordern. Bereits versandte Bestätigungslinks können abgelaufen sein oder noch die alte Weiterleitungsadresse enthalten.

## Eigene Domain

Optional kann unter **Repository → Settings → Pages → Custom domain** eine eigene Domain wie `events.example.de` eingetragen werden. Die Domain muss beim DNS-Anbieter mit den von GitHub Pages angegebenen DNS-Einträgen verknüpft werden. Danach in Supabase dieselbe `https://`-Adresse als Site URL und Redirect URL setzen.

## Lokal testen

Die Seite sollte über einen lokalen HTTP-Server statt über `file://` geöffnet werden, damit Auth-Weiterleitungen funktionieren. Zum Beispiel:

```sh
python3 -m http.server 8000
```

Dann `http://localhost:8000/` im Browser aufrufen und diese Adresse während des lokalen Tests zusätzlich in Supabase als Redirect URL eintragen.
