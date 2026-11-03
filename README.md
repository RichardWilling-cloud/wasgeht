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

## Vorhandenes GitHub-Repository verbinden und veröffentlichen

Die Website wird bei jedem Push auf `main` automatisch mit GitHub Actions auf GitHub Pages veröffentlicht.

Das leere Repository wurde bereits unter <https://github.com/RichardWilling-cloud/woanders> angelegt.

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
   https://richardwilling-cloud.github.io/woanders/
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
