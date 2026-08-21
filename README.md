# 🏸 Stelzengaudi Federballturnier

Eine App für ein Federball-Turnier unter Freunden: Namen eintragen, auslosen,
spielen, Ergebnisse eintragen – und alle sehen denselben Stand.

**K.-o.: Wer verliert, ist raus. Wer sein erstes Spiel verliert, spielt in der
Trostrunde weiter – so hat jede Person mindestens zwei Spiele.**

Beim Öffnen begrüßt euch die Schweinsstelze mit Federballschläger – das
Wappentier des Turniers. Und wer die App zum zwanzigsten Mal öffnet, sieht …
na ja. Die Runde weiß Bescheid.

## Wie gespielt wird

- **Zählweise:** zwei Gewinnsätze bis 12, zwei Punkte Vorsprung, keine
  Obergrenze. **Ab dem Halbfinale gehen die Sätze bis 21** – das gilt für
  Halbfinale, Spiel um Platz 3 und Finale. Die **Trostrunde spielt nur einen
  Satz**, damit der Abend auch mit 18 Leuten reicht. Gewinnsätze, Punktzahlen
  (auch ab dem Halbfinale), Vorsprung, Obergrenze und die Trostrunde sind in
  den Einstellungen änderbar.
- **Vorrunde statt Freilose:** Passt die Personenzahl nicht auf 4, 8, 16 oder 32,
  spielen genau so viele Überzählige eine Vorrunde, dass danach ein volles
  Hauptfeld steht. Niemand kommt kampflos weiter.
- **Vorjahresgewinner** bekommen die vordersten Setzplätze, bleiben von der
  Vorrunde verschont und treffen sich nie in der ersten Runde. Bei bis zu vier
  Markierten geht es frühestens im Halbfinale los – bei zweien erst im Finale;
  ab fünf kann sich ein Duell schon im Viertelfinale ergeben, und die App sagt
  das vor der Auslosung.
- **Trostrunde:** Alle, die ihr erstes Spiel verlieren – aus der Vorrunde wie
  aus der ersten Hauptrunde – kommen in einen zweiten Baum und spielen dort
  den Trostsieger aus.

## Was die App sonst kann

- **Namen eintragen** – einzeln oder als ganze Liste auf einmal, jede Person
  mit ihrer **Einlaufmusik**: die steht unter „Jetzt dran“, sobald das Spiel
  dran ist („🎵 Anna läuft ein zu: Eye of the Tiger“). Wer noch keine hat,
  wird vor der Auslosung daran erinnert.
- **Schiri-Modus** – am Feld mitzählen mit zwei großen Knöpfen und
  „Punkt zurück“. Die laufenden Punkte bleiben auf dem Schiri-Gerät;
  **bei jedem Satzende geht der Stand an alle Mitleser** – so flackern die
  Zuschauer-Ansichten nicht bei jedem Ballwechsel.
- **Nachvollziehbare Auslosung** – die Losnummer wird angezeigt und mit dem
  Stand gespeichert; dieselbe Nummer erzeugt dieselbe Auslosung.
- **Spielplan mit Feldern** – die Runden laufen nacheinander, pro Zeitfenster
  ist jedes Feld genau einmal belegt, niemand ist zweimal gleichzeitig dran.
- **„Jetzt dran“** – ganz oben steht, was auf welchem Feld läuft und was folgt.
- **Ergebnisse eintragen** mit Regelprüfung, dazu kampflose Siege.
- **Korrigieren ohne Kollateralschaden** – ändert sich ein Ergebnis, werden
  betroffene Folgespiele geleert. Ein Ergebnis gilt nur für genau die Paarung,
  für die es eingetragen wurde; ändert sich die Besetzung, verfällt es.
- **Turnierbaum** in der Optik einer WM-Übersicht: linke Hälfte, rechte Hälfte,
  Finale in der Mitte, Spiel um Platz 3 darunter, Trostrunde als eigener Baum.
- **Endstand** mit Gold, Silber und Bronze – erst, wenn das Finale entschieden ist.
- **Nächstes Jahr** – ein Klick macht aus dem Sieger den Vorjahresgewinner des
  Folgeturniers, die Namen bleiben erhalten.
- **Sichern** – automatisch im Browser, Export/Import als Datei, Druckansicht
  (offene Spiele bekommen eine Linie zum Eintragen von Hand).

## Live für alle: ein Link, jeder darf eintragen

Die App läuft als normale Webseite auf **GitHub Pages**:

> **https://lichtflut123.github.io/stelzengaudi-federballturnier/**

Jeder öffnet den Link im Browser – ohne App, ohne Konto. Damit alle denselben
Stand sehen und **jeder eintragen kann**, hängt dahinter ein kostenloser
[Supabase](https://supabase.com)-Dienst. Jede Änderung wird dorthin
geschrieben, alle Geräte fragen alle drei Sekunden nach; ein Versionszähler
sorgt dafür, dass ein älterer Stand nie einen neueren überschreibt – wer bei
gleichzeitiger Eingabe den Kürzeren zieht, bekommt einen Hinweis statt eines
stillen Datenverlusts.

### Einmalige Einrichtung des Dienstes

1. Auf [supabase.com](https://supabase.com) ein kostenloses Konto und darin
   ein Projekt anlegen (Region egal, Free-Plan reicht).
2. Im Projekt links **SQL Editor** öffnen und dieses Skript ausführen:

   ```sql
   create table if not exists public.turnier (
     id   bigint primary key,
     rev  bigint not null default 0,
     state jsonb
   );
   alter table public.turnier enable row level security;
   create policy "alle lesen"     on public.turnier for select using (true);
   create policy "alle schreiben" on public.turnier for update using (true) with check (true);
   create policy "alle anlegen"   on public.turnier for insert with check (true);
   ```

3. Unter **Settings → API** die *Project URL* und den *anon public*-Schlüssel
   kopieren und in `public/sync-config.json` eintragen:

   ```json
   { "url": "https://DEINPROJEKT.supabase.co", "anonKey": "eyJ..." }
   ```

4. Einchecken und pushen – GitHub Pages baut die Seite automatisch neu.

Bleibt die Datei leer, läuft die App rein lokal auf jedem Gerät (ohne
gemeinsamen Stand) – so wie beim Entwickeln.

Offen gesagt: Der anon-Schlüssel ist öffentlich (das ist bei Supabase so
vorgesehen), und die Regeln oben erlauben **jedem mit dem Link alles** –
bewusst so gewählt. Wer den Link hat, kann also auch Unsinn eintragen;
dagegen helfen „Rückgängig“ und der Export als Datei.

### Zusätzlich: die Claude-Artefakt-Fassung

`npm run build:artifact` erzeugt weiterhin `dist-live/artifact-initial.html` –
eine in sich geschlossene Seite mit demselben Funktionsumfang, die als
Claude-Artefakt veröffentlicht wird und sich selbst fortschreibt. Dort trägt
nur ein, wer Bearbeitungsrecht hat. `dist-live/artifact.html` läuft per
Doppelklick komplett ohne Netz – die Rückfallebene für eine Halle ohne Empfang.

## Loslegen

```bash
npm install
npm run dev        # Entwicklungsserver
npm run build      # normale Seite unter dist/
npm run preview    # gebaute Version ansehen
```

## Tests

```bash
npm test           # Vitest: Turnierlogik und Sync-Schicht
npm run build      # enthält den TypeScript-Check
```

Browser-Tests brauchen einmalig einen Browser (`npx playwright install chromium`)
und einen laufenden Preview-Server:

```bash
npm run build && npx vite preview --port 4173 &
npm run e2e                                    # 18 Personen, Vorrunde, Trostrunde, Schiri-Modus, Endstand
npm run build:artifact && npm run e2e:live     # die Claude-Artefakt-Fassung
npm run e2e:cloud                              # zwei Geräte am gemeinsamen Stand
```

## Wie die Auslosung funktioniert

1. Die Vorjahresgewinner bekommen die vordersten Setzränge (untereinander
   gelost), alle anderen werden dahinter zufällig eingereiht.
2. Passt die Personenzahl nicht auf eine Zweierpotenz, spielen die hintersten
   Ränge eine Vorrunde um die restlichen Hauptfeld-Plätze – der jeweils stärkste
   Übriggebliebene gegen den schwächsten.
3. Im Hauptfeld sitzen die Setzränge auf den klassischen Positionen
   (1 oben, 2 unten, 3 und 4 in den gegenüberliegenden Vierteln …). Rang *r*
   trifft in Runde 1 immer auf Rang *Feldgröße + 1 − r*.
4. Die Verlierer der ersten Spiele werden ausgelost auf die Plätze der
   Trostrunde verteilt.

## Aufbau des Codes

```
src/engine/      reine Turnierlogik, ohne Oberfläche, vollständig getestet
  types.ts       Datentypen
  rng.ts         nachvollziehbarer Zufallsgenerator (Losnummer)
  bracket.ts     Auslosung, Setzpositionen, Vorrunde, Trostrunde
  schedule.ts    Zeitfenster, Felder, „Jetzt dran“
  scoring.ts     Zählweise und Regelprüfung
  tournament.ts  alles zusammen: auslosen, eintragen, fortschreiben
  storage.ts     Speichern, Export, Import – mit strenger Prüfung der Daten
src/live.ts      die Claude-Artefakt-Fassung
src/sync.ts      gemeinsamer Stand über Supabase (Lesen/Schreiben mit Versionszähler)
src/useCloud.ts  Verbindungsaufbau, Abgleich und Konfliktmeldung
src/components/  Oberfläche
e2e/             Browser-Tests
scripts/         Bau der Live-Seite
```

Die Logik ist bewusst von der Oberfläche getrennt: seiteneffektfreie
TypeScript-Funktionen, dadurch vollständig testbar.
