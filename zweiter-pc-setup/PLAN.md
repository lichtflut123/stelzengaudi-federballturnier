# Zweiter PC einrichten — Komplettplan (PC 1 → PC 2)

**Für:** Lichtflut Visuals · **Ziel:** PC 2 (Windows) identisch zu PC 1 einrichten — gleiche Programme, gleiches Claude-Code-Setup (Settings, Memory/CLAUDE.md, MCP-Server, Skills), gleicher Zugriff auf das Second Brain, NAS auf beiden PCs sauber eingebunden.

## 1. Überblick

Du musst im Wesentlichen **zwei Skripte starten** und zweimal ein Passwort eintippen:

| Skript | Wo | Was es tut |
|---|---|---|
| `export-pc1.ps1` | PC 1, normale Rechte | Bindet das NAS als Laufwerk `N:` ein, exportiert die komplette Programmliste (winget + Registry-Sicherheitsnetz), die Claude-Code-Konfiguration (**ohne** Tokens/Secrets, mit Secret-Warnscan), die globalen MCP-Server, `.gitconfig`, eine Repo-Liste (eingebettete Zugangsdaten in Remote-URLs werden maskiert) und eine Kopie des Second Brain als **Migrationspaket** auf das NAS (Fallback: USB-Stick). Installiert optional Syncthing auf PC 1. |
| `setup-pc2.ps1` | PC 2, **als Administrator** | Bindet das NAS ein, installiert Git, Node LTS, Claude Code und Syncthing, installiert alle Programme aus dem Export (3 Stufen mit Nachkontrolle), stellt die Claude-Konfiguration wieder her, richtet das Second Brain unter `C:\SecondBrain` ein, legt einen täglichen Backup-Task an (läuft bei angemeldetem Benutzer; verpasste Läufe werden bei der nächsten Anmeldung nachgeholt) und schreibt am Ende einen Report, was ggf. fehlgeschlagen ist. |

**Architektur danach:** NAS auf beiden PCs als `N:` · Second Brain lokal auf beiden PCs unter dem identischen Pfad `C:\SecondBrain`, synchronisiert per Syncthing (offline-fähig, kein Cloud-Dienst) · tägliches Backup des Vaults von PC 2 auf das NAS in datierte Ordner (30 Tage Aufbewahrung; das Backup läuft nur, wenn ein Benutzer angemeldet ist — ein zusätzlicher Anmelde-Trigger holt verpasste Läufe automatisch nach; ist der Vault leer, bricht das Backup ab, statt gute Sicherungsstände wegzurotieren).

Der identische Pfad `C:\SecondBrain` ist Pflicht: Claude Code referenziert den Vault über absolute Pfade (in `CLAUDE.md`-Verweisen und `permissions.additionalDirectories` der `settings.json`). Nur so funktioniert die 1:1 kopierte Konfiguration auf PC 2 sofort. Bewusst **kein** Pfad unter `C:\Users\…`, weil Benutzernamen zwischen PCs abweichen können, und **kein** Netzpfad (Obsidian auf SMB ist fehleranfällig und ohne NAS wäre das Second Brain weg).

## 2. Annahmen (bitte kurz gegenprüfen)

- **ANNAHME:** Beide PCs laufen mit **Windows 11**. Bei Windows 10 (ab 1809) funktioniert alles ebenso, ggf. muss der „App-Installer" (winget) einmal über den Microsoft Store aktualisiert werden. **Falls PC 2 doch ein Mac ist, ist dieser Plan nicht anwendbar** (winget/robocopy/Task-Scheduler sind Windows-Werkzeuge) — dann melden, die Skripte müssten auf Homebrew/rsync/launchd umgestellt werden.
- **ANNAHME:** Das **täglich genutzte Windows-Konto hat Administratorrechte** (Standard bei Einzelplatz-PCs). `setup-pc2.ps1` muss aus **diesem** Konto heraus „als Administrator" gestartet werden — **nicht** aus einem separaten Adminkonto. Sonst landet die gesamte Konfiguration (`.claude`, Autostart-Reparatur, NAS-Anmeldedaten, Backup-Aufgabe) im falschen Benutzerprofil. Das Skript prüft das und **hält bei einem erkannten Konto-Mix an**: Es fragt einmal `Trotzdem fortfahren? (j/N)` — im Zweifel `N` antworten und aus dem richtigen Konto neu starten.
- **ANNAHME:** Das NAS spricht **SMB2/SMB3** und hat ein echtes Benutzerkonto (kein Gastzugriff — Windows 11 blockiert Gast-SMB). Der Weg über `cmdkey` + `net use` funktioniert mit jedem NAS (Synology als häufigster Fall, ebenso QNAP, TrueNAS, Fritz!Box).
- **ANNAHME:** Das Second Brain ist ein **Markdown-Vault, vermutlich Obsidian**. Der Plan funktioniert auch, wenn es kein Obsidian ist — es ist am Ende nur ein Ordner mit Dateien.
- **ANNAHME:** Claude-Login über das **Claude-Abo (Browser-OAuth)**, kein API-Key. Der Login auf PC 2 ist der einzige prinzipbedingt nicht automatisierbare Claude-Schritt (Tokens werden aus Sicherheitsgründen nicht mitkopiert).
- Die Programmliste von PC 1 wird **nicht geraten** — sie wird von `export-pc1.ps1` vollständig ermittelt.

**Dateiformat-Hinweis (wichtig):** Beide `.ps1`-Dateien sind als **UTF-8 mit BOM** gespeichert und müssen es bleiben (beim Bearbeiten z. B. in VS Code rechts unten „UTF-8 with BOM" wählen). Windows PowerShell 5.1 interpretiert Dateien **ohne** BOM als ANSI und zerschießt dann Sonderzeichen. Zur zusätzlichen Absicherung sind Umlaute in den Skript-Ausgaben bewusst als ae/oe/ue geschrieben — so bleibt alles lesbar, selbst wenn das BOM beim Kopieren verloren geht.

## 3. Variablen — die einzigen Werte, die du eintragen musst

Der Variablenblock steht **oben in beiden Skripten** und heißt in beiden gleich. Einmal ausfüllen, in beide Dateien eintragen (gleiche Werte!):

| Variable | Bedeutung | Beispiel | Skript |
|---|---|---|---|
| `$NasHost` | IP oder Name des NAS (feste IP/DHCP-Reservierung empfohlen; überall dieselbe Schreibweise verwenden) | `"192.168.1.20"` | beide |
| `$NasShare` | Name der SMB-Freigabe auf dem NAS | `"daten"` | beide |
| `$NasUser` | NAS-Benutzerkonto (kein Gast!) | `"lichtflut"` | beide |
| `$Laufwerk` | Laufwerksbuchstabe, auf beiden PCs gleich (muss frei sein — die Skripte überschreiben keine fremde Belegung, auch keine „gemerkte") | `"N"` | beide |
| `$VaultPfad` | Kanonischer Second-Brain-Pfad, auf beiden PCs gleich | `"C:\SecondBrain"` | beide |
| `$VaultQuellPfad` | Wo der Vault **heute** auf PC 1 liegt (`""` = liegt schon unter `$VaultPfad`) | `"D:\Notizen\Vault"` | nur export |
| `$ProjektWurzel` | Ordner mit den Git-Repos/Projekten (`""` = Schritt überspringen) | `"D:\Projekte"` | nur export |
| `$TransferUnterordner` | Ordner auf der NAS-Freigabe für das Migrationspaket (**darf nicht leer sein** — die Skripte prüfen das) | `"pc2-umzug"` | beide |
| `$UsbFallbackPfad` | USB-Stick-Pfad, falls das NAS nicht erreichbar ist (`""` = nur NAS) | `"E:\pc2-umzug"` | beide |

Voreingestellt (normalerweise nicht anfassen): `$SyncthingAufPc1Installieren` (export, `$true`), `$BackupUnterordner` (`"Backup\SecondBrain"`), `$AufbewahrungTage` (`30`), `$BackupUhrzeit` (`"21:00"`), `$WindowsGrundeinstellungen` (`$true`) — alle in `setup-pc2.ps1`.

Das NAS-Passwort steht **nirgends in einer Datei**: Es wird pro PC einmal abgefragt und landet ausschließlich im Windows-Anmeldeinformations-Manager (verschlüsselt, pro Benutzer). Schlägt die Verbindung fehl (z. B. Tippfehler), verwerfen die Skripte den gespeicherten Eintrag automatisch und fragen einmal neu. **Ein Sonderfall:** Enthält das NAS-Passwort ein doppeltes Anführungszeichen (`"`), lässt es sich nicht sicher als Befehlsargument übergeben — die Skripte erkennen das, brechen mit einer klaren Anleitung ab und nennen den manuellen Weg (`cmdkey /add:<NAS-IP> /user:<Benutzer> /pass` — cmdkey fragt das Passwort dann interaktiv ab). Am einfachsten: ein NAS-Passwort ohne Anführungszeichen verwenden.

## 4. Checkliste Block 1: Auf PC 1 (ca. 10 Minuten)

1. Ordner `zweiter-pc-setup` (beide Skripte) nach PC 1 kopieren, z. B. nach `C:\Skripte`.
2. Variablenblock **in beiden Skripten** ausfüllen (Tabelle oben — `setup-pc2.ps1` gleich mit, dann ist es später nur noch Kopieren).
3. PowerShell öffnen (normal, **kein** Admin nötig) und starten:
   `powershell -ExecutionPolicy Bypass -File C:\Skripte\export-pc1.ps1`
4. Einmalig das NAS-Passwort eingeben (nur beim ersten Lauf).
5. Falls Syncthing installiert wird: UAC-Abfrage einmal bestätigen. **Hinweis:** Nach der Silent-Installation startet Syncthing unter Umständen erst mit der nächsten Anmeldung. Nach dem Export deshalb am besten einmal **ab- und wieder anmelden** (oder Syncthing einmal über das Startmenü starten) — dann ist die Oberfläche `http://127.0.0.1:8384` für die Kopplung in Block 2 sicher erreichbar.
6. Auf **„Export fertig"** warten. Meldet das Skript stattdessen gelb **„UNVOLLSTAENDIG — Vault fehlt"**: `$VaultQuellPfad` im Variablenblock korrigieren und das Skript erneut ausführen — **nicht** mit PC 2 weitermachen, solange der Vault fehlt. Danach kurz überfliegen: `nicht-automatisch.txt` im Migrationspaket (Programme, die winget nicht kennt — Treiber/Runtimes darin darf man ignorieren) und etwaige Secret-Warnungen im Skript-Output (betrifft auch `gitconfig.txt`/`repo-liste.txt`).
7. **Pflichtschritt, falls der Vault auf den neuen Pfad übernommen wurde:** Obsidian öffnen → „Anderen Vault öffnen" → `C:\SecondBrain` als Vault öffnen und den **alten Vault aus der Vault-Liste entfernen**. Das Skript hat den alten Ordner in `<Name>-ALT-nicht-mehr-verwenden` umbenannt, damit ein versehentliches Weiterarbeiten am alten Ort sofort auffällt. Falls die Umbenennung nicht möglich war (Hinweis im Skript-Output, z. B. weil Obsidian noch offen war): den alten Ordner von Hand so umbenennen.
8. Die ausgefüllte `setup-pc2.ps1` liegt am einfachsten gleich mit im Migrationspaket bzw. auf dem USB-Stick.

## 5. Checkliste Block 2: Auf PC 2 (großteils wartend)

1. `setup-pc2.ps1` auf PC 2 nach `C:\Skripte` kopieren (Ordner ggf. anlegen). Liegt die Datei im Migrationspaket auf dem NAS: **zuerst im Explorer** `\\<NAS>\<Share>` öffnen, im Anmeldedialog NAS-Benutzer/Passwort eingeben und **„Anmeldedaten speichern" anhaken**, dann die Datei kopieren. **Nicht direkt von der NAS-Freigabe starten** — vor dem ersten Skriptlauf hat PC 2 noch keine gespeicherten NAS-Zugangsdaten, und eine Admin-PowerShell erbt die Explorer-Anmeldung nicht zuverlässig.
2. PowerShell **als Administrator** öffnen (aus dem täglich genutzten Konto heraus, siehe Abschnitt 2) und mit **absolutem Pfad** starten:
   `powershell -ExecutionPolicy Bypass -File C:\Skripte\setup-pc2.ps1`
3. Einmalig das NAS-Passwort eingeben. Danach läuft alles ohne Rückfragen. (Einzige Ausnahme: Erkennt das Skript, dass es unter einem **anderen Konto** läuft als dem angemeldeten, fragt es einmal `Trotzdem fortfahren? (j/N)` — im Zweifel `N`, siehe Abschnitt 2.)
4. **Warten.** Der Programm-Import dauert je nach Menge 20–60 Minuten. Das Skript installiert: Git, Node LTS, Claude Code (`Anthropic.ClaudeCode`), Syncthing (`BillStewart.SyncthingWindowsSetup`, richtet Autostart selbst ein) und alles aus `apps.json`.
5. Am Ende den **Report** lesen (Pfad wird angezeigt; Kopie liegt auch im Migrationspaket als `setup-report.txt`).
6. **Neustart**, danach das Skript optional **noch einmal** laufen lassen — es ist idempotent und zieht nur Reste nach (z. B. Pakete, die einen Neustart brauchten). Zwischenzeitliche Änderungen auf PC 2 werden dabei nicht überschrieben (robocopy läuft mit `/XO`, der MCP-Merge ergänzt nur Fehlendes, die `.gitconfig` wird nur übernommen, wenn auf PC 2 noch keine existiert).
7. Neues Terminal öffnen → `claude` eingeben → **Browser-Login** mit dem bestehenden Claude-Konto (Abo wird erkannt). Beim ersten Öffnen eines Projekts die Frage „Trust this folder?" bestätigen (bewusst nicht mitkopiert, da maschinenspezifisch).
8. **Syncthing koppeln** (einmalig, ca. 2 Minuten, beide PCs an, gleiches Netz). **Vorher sicherstellen, dass `C:\SecondBrain` auf PC 2 befüllt ist** (steht im Report — niemals einen leeren Ordner koppeln). **Lädt `http://127.0.0.1:8384` auf einem PC nicht:** Syncthing dort einmal über das Startmenü starten (oder ab- und wieder anmelden), dann die Seite neu laden — der Autostart des Installers greift erst ab der nächsten Anmeldung.
   1. Auf beiden PCs `http://127.0.0.1:8384` öffnen; unter *Aktionen → Einstellungen → GUI* Benutzer/Passwort für die Oberfläche setzen.
   2. Im LAN zeigt jeder PC den anderen als „Neues Gerät gefunden" → auf PC 2 „Gerät hinzufügen", auf PC 1 gegenbestätigen. (Falls der Banner fehlt: PC 1 *Aktionen → ID anzeigen*, ID auf PC 2 unter *Remote-Gerät hinzufügen* einfügen.)
   3. PC 1: *Ordner hinzufügen* → Bezeichnung `SecondBrain`, Ordner-ID `secondbrain`, Pfad `C:\SecondBrain` → Reiter *Teilen* → Haken bei PC 2.
   4. PC 2: Freigabe-Anfrage annehmen, Pfad `C:\SecondBrain` eintragen.
   5. Auf beiden PCs: Ordner *Bearbeiten → Dateiversionierung → Gestaffelte Versionierung*, z. B. 30 Tage.
9. `winget upgrade --all` einmal laufen lassen (bringt alles auf Stand).
10. **Migrationspaket löschen.** Die einzige Datei mit möglichen API-Keys (`mcp-servers.json`) hat `setup-pc2.ps1` nach dem Merge bereits **automatisch gelöscht** (steht im Report). Den restlichen Ordner (`pc2-umzug`) auf der NAS-Freigabe bzw. dem USB-Stick am einfachsten **im Explorer löschen**. Der Report zeigt ggf. zusätzlich einen fertigen `Remove-Item`-Befehl mit dem exakten Pfad an — nur diesen verwenden, keinen Löschbefehl selbst zusammensetzen.

## 6. Manuelle Restliste (Lizenzen, Logins, Hardware — nicht automatisierbar)

1. **Adobe Creative Cloud:** CC-Desktop öffnen → Adobe-ID-Login → die auf PC 1 genutzten Apps anhaken. Lizenz: max. 2 aktivierte Geräte pro Nutzer, ggf. ein Gerät abmelden.
2. **DaVinci Resolve:** nicht in winget — Download von blackmagicdesign.com; Studio-Lizenzschlüssel/Dongle beachten.
3. **Resolume:** Lizenz im Resolume-Account auf PC 2 registrieren.
4. **GPU-Treiber:** NVIDIA-Studio-Treiber bzw. AMD Adrenalin direkt vom Hersteller; idealerweise dieselbe Version wie PC 1 (steht in `programme-komplett.txt`).
5. **Spezialhardware:** Blackmagic Desktop Video, Elgato, ASIO-/Audio-Interface-Treiber, Dongles (iLok, CodeMeter).
6. **Windows-Aktivierung** (an Hardware/Microsoft-Konto gebunden) und *Einstellungen → Apps → Standard-Apps* (Browser, Player — Windows 11 schützt das gegen Skripte, 2 Minuten Handarbeit).
7. **Browser-Logins** (Chrome/Firefox-Sync), TeamViewer/AnyDesk, Notion, E-Mail-Konten.
8. **MCP-Server mit OAuth** (Google/GitHub-Connectoren o. ä.): in einer Claude-Session `/mcp` aufrufen und je einmal durchklicken.
9. **GitHub/Repos:** Repos laut `repo-liste.txt` neu klonen. Bei HTTPS-Remotes reicht der Git Credential Manager (Browser-Fenster beim ersten `git push`). Für SSH: **neuen** Key erzeugen (`ssh-keygen -t ed25519`), Public Key bei GitHub hinterlegen — private Keys werden bewusst nicht kopiert (Maschinenidentität, unsicherer Transportweg).

## 7. Verifikation — ist wirklich alles gleich?

- `claude --version` auf PC 2 mit `manifest.json` aus dem Migrationspaket vergleichen.
- `claude doctor` (prüft Installation, Auth, Settings, MCP) und `claude mcp list` (alle Server „connected"?).
- In einer Claude-Session: `/memory` (globale CLAUDE.md geladen?), `/mcp`, `/config`, einen eigenen Skill über das `/`-Menü antippen.
- `N:` im Explorer auf beiden PCs, auch nach Neustart (Autostart-Reparatur `NAS-Reconnect.cmd` greift notfalls still).
- Sync-Test: Testnotiz in `C:\SecondBrain` auf PC 1 anlegen → erscheint binnen Sekunden auf PC 2; danach löschen.
- Backup-Test: Aufgabe „SecondBrain-Backup" in der Aufgabenplanung einmal manuell starten → auf dem NAS existiert `Backup\SecondBrain\<Datum>`. (Hinweis: Die Aufgabe läuft planmäßig nur, wenn ein Benutzer angemeldet ist; der zusätzliche Anmelde-Trigger holt verpasste Läufe bei der nächsten Anmeldung nach. Bei leerem Vault bricht das Backup bewusst ab — steht dann im Backup-Log unter `%LOCALAPPDATA%\SecondBrain-Backup.log`.)
- Programme: `import-fehlgeschlagen.txt` ist leer/abgearbeitet; Stichprobe gegen `programme-komplett.txt`. Prüfbefehl je Programm: `winget list --id OBSProject.OBSStudio -e` (weitere gängige IDs: `Resolume.Arena`, `Resolume.Avenue`, `Adobe.CreativeCloud`, `Obsidian.Obsidian`, `VideoLAN.VLC`, `7zip.7zip`, `NDI.NDITools` — nur prüfen, nichts blind installieren, die Wahrheit ist `apps.json`).

## 8. Fehlerbehebung (die wahrscheinlichsten Stolpersteine)

1. **NAS: „Zugriff verweigert" oder Fehler 0x80070035.** Windows 11 blockiert SMB1 und Gastzugriff; seit 24H2 ist SMB-Signierung Pflicht. Auf dem NAS echtes Benutzerkonto verwenden und SMB auf SMB2–SMB3 stellen (Synology: *Systemsteuerung → Dateidienste → SMB → Erweiterte Einstellungen*), NAS-Firmware aktualisieren. **Falsches NAS-Passwort gespeichert?** Die Skripte erkennen eine fehlgeschlagene Verbindung, verwerfen den gespeicherten Eintrag und fragen einmal neu. Manueller Ausweg: `cmdkey /delete:<NAS-IP>` ausführen und das Skript neu starten. **Anführungszeichen im NAS-Passwort?** Ein doppeltes Anführungszeichen (`"`) im Passwort lässt sich nicht sicher automatisch speichern — die Skripte melden das und nennen den manuellen Weg: `cmdkey /add:<NAS-IP> /user:<Benutzer> /pass` (fragt interaktiv). Am einfachsten das NAS-Passwort ohne Anführungszeichen wählen.
2. **`N:` fehlt nach Neustart oder im Admin-Fenster.** Netzlaufwerke gelten pro Anmeldesitzung; elevierte Terminals sehen sie oft nicht. Die Skripte legen `NAS-Reconnect.cmd` in den Autostart (löst auch hängende „getrennte" Zuordnungen und verbindet still nach). In Admin-Terminals notfalls den UNC-Pfad `\\<NAS>\<Share>` verwenden — die Skripte selbst tun das intern bereits.
3. **winget fehlt oder meckert.** „App-Installer" über den Microsoft Store aktualisieren; beim allerersten winget-Aufruf die Quellvereinbarung bestätigen.
4. **Einzelne Pakete schlagen fehl.** Steht alles in `import-fehlgeschlagen.txt`: msstore-Pakete brauchen ggf. ein Microsoft-Konto, manche Installer sind nur interaktiv (einmal von Hand), manche brauchen einen Neustart → neu starten und `setup-pc2.ps1` erneut laufen lassen (idempotent).
5. **`claude` wird nach der Installation nicht gefunden.** Neues Terminal öffnen (PATH wird erst dann neu geladen). Wichtig: Claude Code wurde per winget installiert — **nicht zusätzlich** den nativen Installer (`irm https://claude.ai/install.ps1 | iex`) laufen lassen, das erzeugt Doppelinstallationen. Updates: `winget upgrade Anthropic.ClaudeCode`.
6. **Umlaut-Salat in Skriptausgaben.** Die Datei wurde ohne BOM gespeichert → im Editor als „UTF-8 mit BOM" neu speichern (siehe Hinweis in Abschnitt 2).
7. **Syncthing sieht den anderen PC nicht.** Beide PCs im selben Netz? Netzwerkprofil auf „Privat" (die Firewall-Regeln gelten für Domain/Privat)? Sonst Geräte-ID manuell hinzufügen (Schritt 8.2 oben).
8. **Syncthing-Oberfläche `http://127.0.0.1:8384` lädt nicht.** Syncthing läuft auf diesem PC (noch) nicht — das passiert vor allem auf PC 1, wo nach der Silent-Installation kein Neustart/Neuanmelden stattfand. Syncthing einmal über das **Startmenü** starten (oder ab- und wieder anmelden), dann die Seite neu laden.
9. **„Laufwerk N: ist bereits belegt."** Ist der Buchstabe schon mit einer anderen Freigabe oder einem lokalen Laufwerk belegt — auch als „gemerkte" (aktuell getrennte) Zuordnung in der Registrierung —, brechen die Skripte bewusst ab, statt etwas zu überschreiben oder zu löschen. In **beiden** Skripten `$Laufwerk` auf einen freien Buchstaben ändern und neu starten.

## 9. Sicherheit — was bewusst NICHT kopiert wird

| Nicht kopiert | Grund |
|---|---|
| `%USERPROFILE%\.claude\.credentials.json` | OAuth-Access-/Refresh-Token im Klartext. Kopieren = Secret auf NAS/USB + Refresh-Konflikte zwischen zwei Maschinen. Der Browser-Login auf PC 2 dauert 30 Sekunden. |
| `.claude.json` als Ganzes | Enthält Login-Session, Kontozustand und Projekt-Trust mit PC-1-Pfaden. Es wird **nur** der Schlüssel `mcpServers` extrahiert und auf PC 2 **echt gemerged**: Nur dort fehlende Server werden ergänzt — auf PC 2 bereits vorhandene Einträge (inkl. frisch eingetragener Zugangsdaten) bleiben unangetastet. |
| Session-Transkripte, `shell-snapshots`, `statsig`, `todos`, Caches | Maschinenzustand von PC 1 — nutzlos bis schädlich. Ausnahme: die `memory\`-Unterordner (Auto-Memory je Projekt) werden gezielt mitgenommen. |
| Private SSH-Keys, MCP-OAuth-Tokens | Maschinenidentität — pro PC frisch erzeugen/anmelden (Restliste Punkte 8–9). |

Vier Rest-Sonderfälle, ehrlich benannt:

1. `mcp-servers.json` kann API-Keys aus `env`-Blöcken der MCP-Konfiguration enthalten — deshalb **löscht `setup-pc2.ps1` diese Datei direkt nach erfolgreichem Merge automatisch** (steht im Report). Sie liegt also nur für die Dauer des Setups auf NAS/USB.
2. Auch `settings.json`/`settings.local.json` im `dot-claude`-Paket **können** Secrets enthalten (z. B. `env`-Blöcke mit `ANTHROPIC_API_KEY`, `apiKeyHelper`-Konfiguration). `export-pc1.ps1` scannt das Paket danach und warnt mit Dateinamen — garantiert „secret-frei" ist das Paket damit aber nicht. Deshalb gilt trotzdem: **Migrationspaket nach erfolgreichem Setup komplett löschen** (Schritt 10 in Block 2, steht auch im Report).
3. Die `.gitconfig` und Git-Remote-URLs können eingebettete Tokens enthalten (`insteadOf`-Regeln oder URLs der Form `https://user:TOKEN@github.com/…`). Der Export **maskiert** solche Zugangsdaten beim Schreiben der `repo-liste.txt` automatisch (`https://***@…` — zum Neu-Klonen reicht die bereinigte URL) und **scannt** zusätzlich `gitconfig.txt` und `repo-liste.txt` auf Token-Muster (`ghp_`, `github_pat_`, `glpat-`, URL-Credentials). Bei Treffern warnt er deutlich — dann das Token am besten aus der `.gitconfig` auf PC 1 entfernen (dafür ist der Git Credential Manager da) und den Export wiederholen.
4. Das NAS-Passwort wird beim Speichern **einmalig kurz als Prozessargument** an `cmdkey` übergeben. Auf Systemen mit aktivierter Kommandozeilen-Protokollierung (Prozessüberwachung Event 4688 mit Command-Line-Logging, PowerShell-Transcription) könnte es dort im Klartext auftauchen — auf einem normalen Einzelplatz-PC ist das nicht aktiv. Wer es ganz ausschließen will, legt den Eintrag **vor** dem Skriptlauf manuell an: `cmdkey /add:<NAS-IP> /user:<Benutzer> /pass` (interaktive Abfrage, Passwort erscheint nie in einer Kommandozeile) — die Skripte erkennen den vorhandenen Eintrag und überspringen die eigene Speicherung.
