# ============================================================
# setup-pc2.ps1
# Laeuft auf PC 2 - ALS ADMINISTRATOR ausfuehren, und zwar aus dem
# taeglich genutzten Windows-Konto heraus (siehe PLAN.md, Abschnitt 2).
#
# Richtet PC 2 (Threadripper-Workstation, stationaer im LAN bei der
# WD My Cloud EX2 Ultra) identisch zu PC 1 ein:
#   1. NAS als Netzlaufwerk (cmdkey + net use, Autostart-Reparatur)
#   2. Migrationspaket vom NAS (Fallback USB) suchen
#   3. Grundwerkzeuge: Git, Node LTS, Claude Code, Syncthing, Tailscale
#   4. Alle Programme aus apps.json (3 Stufen mit Nachkontrolle)
#   5. Claude-Konfiguration wiederherstellen + MCP-Server mergen + .gitconfig
#      (vorhandene PC-2-Konfiguration inkl. Auto-Memory wird VORHER weggesichert;
#      Erstlauf: PC-1-Stand gewinnt, erneute Laeufe: /XO schuetzt PC-2-Aenderungen)
#   6. Second Brain unter $VaultPfad einrichten (Startstand + Firewall)
#   7. Taeglichen Backup-Task (Vault UND Projekte -> NAS, datierte Ordner,
#      VERSIONIERT statt Spiegel, mit Nachholstart und Erreichbarkeits-
#      pruefung) anlegen - Beschluss: 'Vault + Projekte naechtlich aufs NAS'
#   8. Windows-Grundeinstellungen (optional, Standard AUS - PC 2 ist in Benutzung)
#   9. Abschlussreport: was hat NICHT geklappt + naechste Handgriffe
#
# WICHTIG: VOR dem ersten Lauf den 15-Minuten-Sicherheits-Check der
# EX2 Ultra durchfuehren (PLAN.md, Abschnitt 3) und unten
# $Ex2CheckBestaetigt = $true setzen - sonst bricht das Skript ab.
# Die EX2 Ultra ist nur Transfermedium + INTERIMS-Backupziel; beim
# spaeteren Umstieg auf die Synology DS925+ muss NUR $BackupZielWurzel
# geaendert werden.
#
# Idempotent: mehrfaches Ausfuehren ist erwuenscht (zieht Reste nach,
# z.B. Pakete, die einen Neustart brauchten). Der ERSTE Lauf stellt nach
# vollstaendiger Wegsicherung bewusst den PC-1-Stand her (Ziel: identisches
# Setup); ab dem ZWEITEN Lauf werden zwischenzeitliche Aenderungen auf PC 2
# NICHT ueberschrieben (robocopy /XO, MCP-Merge ergaenzt nur Fehlendes,
# .gitconfig wird nur uebernommen, wenn noch keine existiert).
# Als UTF-8 mit BOM speichern. Kompatibel mit Windows PowerShell 5.1
# (kein &&, kein ??, keine ternaeren Operatoren).
# Umlaute in Ausgaben bewusst als ae/oe/ue geschrieben.
# Start: powershell -ExecutionPolicy Bypass -File C:\Skripte\setup-pc2.ps1
# ============================================================

# ==================== VARIABLEN (EINMAL AUSFUELLEN) ====================
$NasHost             = "192.168.1.20"    # IP oder Name der WD My Cloud EX2 Ultra (z.B. "WDMYCLOUD"); "" = kein NAS
$NasShare            = "daten"           # Name der SMB-Freigabe auf der EX2
$NasUser             = "lichtflut"       # EX2-Benutzerkonto (ECHTER Benutzer, kein Gastzugriff!)
$Ex2CheckBestaetigt  = $false            # ERST auf $true setzen, wenn der 15-Minuten-Sicherheits-Check
                                         # der EX2 Ultra erledigt ist (PLAN.md, Abschnitt 3)!
$Laufwerk            = "N"               # Laufwerksbuchstabe, auf BEIDEN PCs gleich (muss frei sein)
$VaultPfad           = "C:\SecondBrain"  # kanonischer Second-Brain-Pfad (auf BEIDEN PCs gleich; NICHT in OneDrive!)
$TransferUnterordner = "pc2-umzug"       # Ordnername auf der NAS-Freigabe (wie in export-pc1.ps1; NICHT leer lassen!)
$UsbFallbackPfad     = ""                # z.B. "E:\pc2-umzug", falls das Paket auf USB liegt
# --- Voreinstellungen (normalerweise nicht anfassen) ---
# Backup-Ziel: DIE eine Variable fuer den spaeteren NAS-Umstieg.
# "" = Standard: \\$NasHost\$NasShare\Backup\SecondBrain (EX2 Ultra = INTERIMS-Ziel).
# Wenn die Synology DS925+ da ist (nach den Projekten Saatgut & LWK OOe):
# NUR hier den neuen UNC-Pfad eintragen, z.B. "\\DS925\backup\SecondBrain",
# und das Skript erneut laufen lassen - sonst nichts aendern.
$BackupZielWurzel          = ""
# Projektordner fuer das naechtliche NAS-Backup (Beschluss laut Dossier:
# Vault UND Projekte werden gesichert). Nach dem Klonen der Repos auf PC 2
# die Repo-Wurzeln hier eintragen, z.B. @("D:\zettl-app") - Fundorte stehen
# in repo-liste.txt im Migrationspaket. @() = vorerst nur Vault; das Skript
# erinnert dann im Report daran, die Liste zu fuellen und erneut zu laufen.
$ProjekteBackupQuellen     = @()
$AufbewahrungTage          = 30                    # so viele datierte Tagesstaende behaelt das Backup (VERSIONIERT, kein /MIR-Spiegel)
$BackupUhrzeit             = "21:00"               # taegliche Backup-Uhrzeit
$WindowsGrundeinstellungen = $false                # Explorer-/Energie-Einstellungen setzen. Standard AUS:
                                                   # PC 2 ist SCHON IN BENUTZUNG - bewusstes Opt-in ($true).
                                                   # Wenn aktiviert, sichert das Skript die vorherigen Werte
                                                   # in den pc2-setup-Ordner (wiederherstellbar).
# =======================================================================

$ErrorActionPreference = "Continue"   # Einzelfehler stoppen den Lauf nicht - sie landen im Report
$ClaudeDir  = Join-Path $env:USERPROFILE ".claude"
$ClaudeJson = Join-Path $env:USERPROFILE ".claude.json"
$LogOrdner  = Join-Path $env:LOCALAPPDATA "pc2-setup"
New-Item -ItemType Directory -Force -Path $LogOrdner | Out-Null
$LogDatei   = Join-Path $LogOrdner "setup-protokoll.txt"

$Fehler   = New-Object System.Collections.ArrayList
$Hinweise = New-Object System.Collections.ArrayList
function Melde-Fehler([string]$Text)  { [void]$Fehler.Add($Text);   Write-Warning $Text }
function Melde-Hinweis([string]$Text) { [void]$Hinweise.Add($Text) }

function Install-WingetPaket([string]$Id) {
    # Idempotent: erst pruefen, dann installieren, dann verifizieren.
    winget list --id $Id -e --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  $Id ist bereits installiert." -ForegroundColor Gray
        return $true
    }
    Write-Host "  Installiere $Id ..."
    winget install --id $Id -e --silent --accept-package-agreements --accept-source-agreements 2>&1 |
        Out-File -FilePath $LogDatei -Append -Encoding UTF8
    winget list --id $Id -e | Out-Null
    if ($LASTEXITCODE -eq 0) { return $true }
    return $false
}

function Speichere-NasZugang([string]$Ziel, [string]$Benutzer, [string]$Passwort) {
    # cmdkey bekommt das Passwort als Kommandozeilenargument. Windows
    # PowerShell 5.1 escapet eingebettete Anfuehrungszeichen dabei NICHT -
    # ein Passwort mit '"' wuerde zerhackt und ein FALSCHES Passwort
    # gespeichert (auch der Retry wuerde dann endlos scheitern).
    # Deshalb: klare Meldung statt stiller Fehlspeicherung.
    if ($Passwort -match '"') {
        Write-Warning "Das NAS-Passwort enthaelt ein doppeltes Anfuehrungszeichen - so laesst es sich nicht sicher automatisch speichern."
        Write-Warning "Bitte EINMALIG manuell ausfuehren: cmdkey /add:$Ziel /user:$Benutzer /pass"
        Write-Warning "(cmdkey fragt das Passwort dann interaktiv ab - es erscheint nie in einer Kommandozeile.) Danach dieses Skript neu starten."
        return $false
    }
    # Win32-Argumentregel: Backslashes am Passwort-Ende verdoppeln - aber NUR,
    # wenn PowerShell das Argument tatsaechlich in Anfuehrungszeichen setzt.
    # PS 5.1 quotet native Argumente nur bei enthaltenem Whitespace; ein
    # Passwort OHNE Leerzeichen wird ungequotet uebergeben, und eine
    # Verdopplung wuerde dann ein FALSCHES Passwort (doppelter Backslash)
    # speichern - exakt die stille Fehlspeicherung, die verhindert werden soll.
    if ($Passwort -match '\s') {
        $pwArg = $Passwort -replace '(\\+)$', '$1$1'
    } else {
        $pwArg = $Passwort
    }
    cmdkey /add:"$Ziel" /user:"$Benutzer" /pass:"$pwArg" | Out-Null
    return $true
}

Write-Host "=== setup-pc2: Start ===" -ForegroundColor Cyan

# --- Vorbedingungen ---
$istAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $istAdmin) {
    Write-Warning "Bitte PowerShell 'Als Administrator ausfuehren' und das Skript erneut starten."
    exit 1
}
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Warning "winget fehlt. Bitte 'App-Installer' im Microsoft Store aktualisieren und erneut starten."
    exit 1
}
if ([string]::IsNullOrWhiteSpace($TransferUnterordner)) {
    Write-Warning "TransferUnterordner darf nicht leer sein (sonst zeigt alles auf die Freigabe-Wurzel). Bitte im Variablenblock setzen (z.B. 'pc2-umzug')."
    exit 1
}
# Pflichtschritt VOR jeder NAS-Nutzung: 15-Minuten-Sicherheits-Check der
# EX2 Ultra (Portweiterleitungen raus, Cloud Access/DLNA/Indexing aus,
# echter Benutzer, Firmware OS3 vs. OS5, ggf. Passwortwechsel).
# Details: PLAN.md, Abschnitt 3. Ohne Bestaetigung kein NAS-Zugriff.
if ($NasHost -ne "" -and -not $Ex2CheckBestaetigt) {
    Write-Warning "EX2-Sicherheits-Check noch nicht bestaetigt. Bitte den 15-Minuten-Check laut PLAN.md (Abschnitt 3) durchfuehren und dann im Variablenblock Ex2CheckBestaetigt = `$true setzen."
    exit 1
}
# Der Vault gehoert NICHT in einen OneDrive-Ordner: OneDrive bleibt
# unangetastet der Sync-Layer fuer '01_Buero'; der Vault laeuft separat
# ueber Syncthing (zwei Sync-Dienste auf demselben Ordner = Konflikte).
if ($VaultPfad -like "*OneDrive*") {
    Write-Warning "VaultPfad '$VaultPfad' liegt in einem OneDrive-Ordner - bitte einen lokalen Pfad ausserhalb von OneDrive waehlen (Standard: C:\SecondBrain)."
    exit 1
}
# Konto-Mix erkennen: Das Setup schreibt alles in das Profil des AUSFUEHRENDEN
# Kontos (~\.claude, Autostart, cmdkey, Backup-Task). Laeuft das Skript unter
# einem anderen Konto als dem angemeldeten, landet die Konfiguration im
# falschen Profil. Deshalb hier ANHALTEN und explizit nachfragen - eine
# blosse Warnung wuerde beim 20-60-Minuten-Lauf sofort aus dem Sichtfeld
# scrollen, und das Aufraeumen im fremden Profil ist muehsam.
try {
    $konsolenBenutzer = (Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop).UserName
    if ($konsolenBenutzer) {
        $aktuellerBenutzer = "$env:USERDOMAIN\$env:USERNAME"
        if ($konsolenBenutzer -ne $aktuellerBenutzer) {
            Write-Warning "ACHTUNG: Dieses Fenster laeuft als '$aktuellerBenutzer', am PC angemeldet ist aber '$konsolenBenutzer'."
            Write-Warning "Das Setup schreibt alles in das Profil des AUSFUEHRENDEN Kontos - vermutlich das FALSCHE. Empfohlen: abbrechen und aus dem taeglich genutzten Konto heraus 'Als Administrator' starten (PLAN.md, Abschnitt 2)."
            $antwort = Read-Host "Trotzdem fortfahren? (j/N)"
            if ($antwort -ne "j") {
                Write-Host "Abgebrochen. Bitte aus dem taeglich genutzten Konto heraus 'Als Administrator' starten (PLAN.md, Abschnitt 2)."
                exit 1
            }
            Melde-Hinweis "Konto-Mix erkannt und vom Nutzer ausdruecklich bestaetigt: Skript lief als '$aktuellerBenutzer', angemeldet war '$konsolenBenutzer'."
        }
    }
} catch { }

# ---------------------------------------------------------------
# Schritt 1: NAS als Netzlaufwerk einbinden (idempotent).
# Passwort landet NUR im Windows-Anmeldeinformations-Manager.
# Hinweis: Das Skript laeuft erhoeht; im normalen Explorer erscheint
# N: spaetestens nach dem naechsten Anmelden (Autostart-Reparatur).
# ---------------------------------------------------------------
Write-Host "--- Schritt 1: NAS einbinden ---"
if ($NasHost -ne "") {
    $UncFreigabe = "\\$NasHost\$NasShare"
    try {
        # Merker: Wurde der Credential-Manager-Eintrag in DIESEM Lauf angelegt?
        # Nur dann darf er bei einem Verbindungsfehler geloescht werden - ein
        # vorbestehender Eintrag koennte von anderer Software genutzt werden
        # (PC 2 ist in Benutzung und greift evtl. heute schon aufs NAS zu).
        $eintragNeuAngelegt = $false
        $eintragVorhanden = cmdkey /list | Select-String -SimpleMatch $NasHost
        if (-not $eintragVorhanden) {
            $cred = Get-Credential -UserName $NasUser -Message "Passwort des NAS-Benutzers '$NasUser' eingeben"
            if ($cred) {
                $pw = $cred.GetNetworkCredential().Password
                $gespeichert = Speichere-NasZugang $NasHost $cred.UserName $pw
                Remove-Variable pw, cred
                if ($gespeichert) {
                    $eintragNeuAngelegt = $true
                    Write-Host "  Zugangsdaten fuer $NasHost gespeichert."
                } else {
                    Melde-Fehler "NAS-Zugangsdaten nicht gespeichert (Anfuehrungszeichen im Passwort) - Hinweis oben befolgen, dann Skript neu starten."
                }
            } else {
                Melde-Fehler "NAS-Zugangsdaten nicht eingegeben - NAS-Schritte werden fehlschlagen."
            }
        }
        $psLaufwerk = Get-PSDrive -Name $Laufwerk -ErrorAction SilentlyContinue
        if ($psLaufwerk -and $psLaufwerk.DisplayRoot -eq $UncFreigabe) {
            Write-Host "  Laufwerk ${Laufwerk}: ist bereits mit $UncFreigabe verbunden."
        } elseif ($psLaufwerk) {
            # NIEMALS eine fremde Zuordnung loeschen.
            $belegtMit = $psLaufwerk.DisplayRoot
            if (-not $belegtMit) { $belegtMit = "ein lokales Laufwerk" }
            throw "Laufwerk ${Laufwerk}: ist bereits mit '$belegtMit' belegt - bitte in BEIDEN Skripten einen anderen Buchstaben in der Variable Laufwerk waehlen."
        } else {
            # Sicherheitscheck VOR dem Loeschen: In der erhoehten Admin-Session
            # sieht Get-PSDrive die Netzlaufwerke der normalen Anmeldesitzung
            # oft NICHT (UAC-Token-Split). In HKCU:\Network gemerkte persistente
            # Zuordnungen gelten aber pro Benutzer - zeigt die gemerkte
            # Zuordnung auf eine ANDERE Freigabe, wird NICHT geloescht,
            # sondern abgebrochen (Zusage: nie fremde Zuordnungen loeschen).
            $gemerkt = (Get-ItemProperty -Path "HKCU:\Network\$Laufwerk" -ErrorAction SilentlyContinue).RemotePath
            if ($gemerkt -and ($gemerkt -ne $UncFreigabe)) {
                throw "Laufwerk ${Laufwerk}: ist (als gemerkte Zuordnung dieses Benutzers) bereits mit '$gemerkt' belegt - bitte in BEIDEN Skripten einen anderen Buchstaben in der Variable Laufwerk waehlen."
            }
            # Gemerkte/tote Zuordnung AUF DIESELBE Freigabe (Systemfehler 85
            # nach dem Boot) vorab still entfernen - fremde Ziele sind oben
            # ausgeschlossen.
            net use "${Laufwerk}:" /delete /y 2>$null | Out-Null
            net use "${Laufwerk}:" "$UncFreigabe" /persistent:yes 2>&1 | Out-Null
            $netExit = $LASTEXITCODE
            if ($netExit -ne 0) {
                if ($eintragNeuAngelegt) {
                    # Haeufigste Ursache: beim ersten Lauf falsch eingetipptes Passwort
                    # gespeichert -> Eintrag verwerfen, neu abfragen, EINMAL wiederholen.
                    # Geloescht wird NUR der in diesem Lauf angelegte Eintrag.
                    Write-Warning "  Verbindung fehlgeschlagen - die soeben gespeicherten Zugangsdaten werden verworfen, bitte Passwort erneut eingeben."
                    cmdkey /delete:$NasHost 2>$null | Out-Null
                    $cred = Get-Credential -UserName $NasUser -Message "NAS-Passwort erneut eingeben (vorheriger Versuch schlug fehl)"
                    if ($cred) {
                        $pw = $cred.GetNetworkCredential().Password
                        $gespeichert = Speichere-NasZugang $NasHost $cred.UserName $pw
                        Remove-Variable pw, cred
                        if ($gespeichert) {
                            net use "${Laufwerk}:" "$UncFreigabe" /persistent:yes 2>&1 | Out-Null
                            $netExit = $LASTEXITCODE
                        }
                    }
                } else {
                    # Der Eintrag im Anmeldeinformations-Manager ist VORBESTEHEND
                    # (evtl. von anderer Software auf PC 2 genutzt) - er wird
                    # NICHT geloescht. Der Fehler kann auch an falscher Freigabe,
                    # NAS offline oder einem SMB-Problem liegen.
                    Write-Warning "  Verbindung fehlgeschlagen. Der gespeicherte NAS-Eintrag stammt NICHT aus diesem Lauf und wird deshalb NICHT geloescht (andere Programme koennten ihn nutzen)."
                    Write-Warning "  Bitte pruefen: NAS eingeschaltet? Freigabe '$NasShare' korrekt? Erst wenn das gespeicherte Passwort SICHER falsch ist: 'cmdkey /delete:$NasHost' manuell ausfuehren und das Skript neu starten."
                }
            }
            if ($netExit -ne 0) {
                Melde-Fehler "Laufwerk ${Laufwerk}: konnte nicht mit $UncFreigabe verbunden werden (net use Exit-Code $netExit). Hinweise oben beachten - vorbestehende Zugangsdaten werden NICHT automatisch geloescht; nur bei sicher falschem Passwort selbst 'cmdkey /delete:$NasHost' ausfuehren und neu starten."
            } else {
                Write-Host "  Laufwerk ${Laufwerk}: verbunden mit $UncFreigabe."
            }
        }
        # Autostart-Reparatur (greift auch fuer die normale, nicht erhoehte
        # Sitzung): loest haengende 'getrennte' Zuordnungen (Systemfehler 85)
        # und verbindet still nach. UNC-Pfad gequotet (Leerzeichen!).
        $autostartOrdner = [Environment]::GetFolderPath('Startup')
        $reparaturDatei  = Join-Path $autostartOrdner "NAS-Reconnect.cmd"
        $inhalt = "@echo off`r`n" +
                  "if not exist ${Laufwerk}:\ (`r`n" +
                  "  net use ${Laufwerk}: /delete /y >nul 2>&1`r`n" +
                  "  net use ${Laufwerk}: `"$UncFreigabe`" /persistent:yes`r`n" +
                  ")"
        Set-Content -Path $reparaturDatei -Value $inhalt -Encoding Ascii
        if (-not (Test-Path "$UncFreigabe")) {
            Melde-Fehler "NAS-Freigabe $UncFreigabe nicht erreichbar. NAS an? SMB2/3 aktiv? Benutzer korrekt? Falsches Passwort gespeichert? -> 'cmdkey /delete:$NasHost' und neu starten."
        }
    } catch {
        Melde-Fehler ("NAS-Einbindung fehlgeschlagen: " + $_.Exception.Message)
    }
} else {
    Melde-Hinweis "Kein NAS konfiguriert (NasHost leer) - NAS-Schritte uebersprungen."
}

# ---------------------------------------------------------------
# Schritt 2: Migrationspaket finden (NAS, Fallback USB)
# ---------------------------------------------------------------
Write-Host "--- Schritt 2: Migrationspaket suchen ---"
$TransferPfad = $null
if ($NasHost -ne "" -and (Test-Path "\\$NasHost\$NasShare\$TransferUnterordner")) {
    $TransferPfad = "\\$NasHost\$NasShare\$TransferUnterordner"
}
if (-not $TransferPfad -and $UsbFallbackPfad -ne "" -and (Test-Path $UsbFallbackPfad)) {
    $TransferPfad = $UsbFallbackPfad
}
if ($TransferPfad) {
    Write-Host "  Migrationspaket gefunden: $TransferPfad"
} else {
    Melde-Fehler "Migrationspaket nicht gefunden - zuerst export-pc1.ps1 auf PC 1 ausfuehren. Paketabhaengige Schritte werden uebersprungen."
}

# ---------------------------------------------------------------
# Schritt 3: Grundwerkzeuge (Git, Node LTS, Claude Code, Syncthing,
# Tailscale). Claude Code bewusst per winget (ein Update-Weg:
# winget upgrade --all); NICHT zusaetzlich den nativen Installer
# verwenden (Doppelinstallation).
# Tailscale = beschlossene Architektur auf BEIDEN PCs (Laptop unterwegs
# erreicht Syncthing/NAS ueber Tailscale statt Portfreigaben).
# Login danach manuell (PLAN.md, Restliste).
# GitHub-Zugang auf PC 2: HTTPS + Git Credential Manager (im Git.Git-
# Paket enthalten; Browser-Login beim ersten git push) - kein SSH-Key-Kopieren.
# ---------------------------------------------------------------
Write-Host "--- Schritt 3: Grundwerkzeuge installieren ---"
# Bitwarden und WizTree sind ZUSAETZLICHE Programme aus dem Heimserver-Plan
# (unabhaengig vom PC-1-Bestand, also unabhaengig von apps.json) - deshalb
# hier fest in der Liste. Install-WingetPaket ist idempotent: bereits
# installierte Pakete werden uebersprungen.
foreach ($paket in @("Git.Git", "OpenJS.NodeJS.LTS", "Anthropic.ClaudeCode", "BillStewart.SyncthingWindowsSetup", "Tailscale.Tailscale", "Bitwarden.Bitwarden", "AntibodySoftware.WizTree")) {
    if (-not (Install-WingetPaket $paket)) { Melde-Fehler "Installation fehlgeschlagen: $paket" }
}

# ---------------------------------------------------------------
# Schritt 4: Programme aus apps.json installieren (3 Stufen)
# ---------------------------------------------------------------
Write-Host "--- Schritt 4: Programme aus dem Export installieren (das dauert - laufen lassen) ---"
$AppsJson = $null
if ($TransferPfad) { $AppsJson = Join-Path $TransferPfad "apps.json" }
if ($AppsJson -and (Test-Path $AppsJson)) {
    winget source update | Out-Null

    # Stufe 1: Sammel-Import (laeuft bei Einzelfehlern weiter)
    winget import -i $AppsJson --accept-package-agreements --accept-source-agreements --ignore-unavailable --ignore-versions 2>&1 |
        Tee-Object -FilePath (Join-Path $LogOrdner "import-protokoll.txt")

    # Stufe 2: Nachkontrolle jedes Pakets gegen apps.json
    $Export = Get-Content -LiteralPath $AppsJson -Raw | ConvertFrom-Json
    $Fehlend = @()
    foreach ($Quelle in $Export.Sources) {
        foreach ($Paket in $Quelle.Packages) {
            $Id = $Paket.PackageIdentifier
            winget list --id $Id -e | Out-Null
            if ($LASTEXITCODE -ne 0) { $Fehlend += $Id }
        }
    }

    # Stufe 3: zweiter Versuch einzeln; Rest -> import-fehlgeschlagen.txt
    $WeiterFehlend = @()
    if ($Fehlend.Count -gt 0) {
        Write-Host ("  {0} Paket(e) fehlen noch - zweiter Versuch einzeln ..." -f $Fehlend.Count)
        foreach ($Id in $Fehlend) {
            if (-not (Install-WingetPaket $Id)) { $WeiterFehlend += $Id }
        }
    }
    if ($WeiterFehlend.Count -gt 0) {
        $FehlerDatei = Join-Path $TransferPfad "import-fehlgeschlagen.txt"
        @("# Diese Pakete konnten NICHT automatisch installiert werden - bitte manuell installieren.",
          "# Details im import-protokoll.txt unter $LogOrdner",
          "") + $WeiterFehlend | Out-File -FilePath $FehlerDatei -Encoding UTF8
        Melde-Fehler ("{0} winget-Paket(e) fehlgeschlagen - Liste: {1}" -f $WeiterFehlend.Count, $FehlerDatei)
    } else {
        Write-Host "  Alle Pakete aus apps.json sind installiert." -ForegroundColor Green
    }
} else {
    Melde-Fehler "apps.json nicht gefunden - Programm-Import uebersprungen."
}

# ---------------------------------------------------------------
# Schritt 5: Claude-Konfiguration wiederherstellen
# ---------------------------------------------------------------
Write-Host "--- Schritt 5: Claude-Konfiguration wiederherstellen ---"
# PC 2 ist SCHON IN BENUTZUNG: vorhandene Konfiguration wird VOR jedem
# Wiederherstellen in einen datierten Sicherungsordner weggesichert.
# So laesst sich jede Aenderung dieses Skripts rueckgaengig machen.
$sicherungsStempel = Get-Date -Format "yyyyMMdd-HHmmss"
$sicherungsOrdner  = Join-Path $LogOrdner ("konfig-sicherung-" + $sicherungsStempel)
if ($TransferPfad -and (Test-Path (Join-Path $TransferPfad "dot-claude"))) {
    $paketDotClaude = Join-Path $TransferPfad "dot-claude"
    $sicherungOk = $true
    if (Test-Path $ClaudeDir) {
        robocopy $ClaudeDir (Join-Path $sicherungsOrdner "dot-claude") /E /R:1 /W:1 /XD projects shell-snapshots statsig todos cache file-history downloads debug ide logs | Out-Null
        if ($LASTEXITCODE -ge 8) {
            $sicherungOk = $false
            Melde-Fehler "Wegsicherung der vorhandenen .claude-Konfiguration fehlgeschlagen (robocopy-Code $LASTEXITCODE) - Wiederherstellung wird uebersprungen, nichts wurde ueberschrieben."
        } else {
            Melde-Hinweis ("Vorhandene .claude-Konfiguration von PC 2 gesichert nach: " + (Join-Path $sicherungsOrdner "dot-claude"))
        }
        # Auto-Memory von PC 2 GEZIELT mitsichern: 'projects' ist oben wegen
        # der grossen Unterordner (Transkripte etc.) ausgeschlossen, aber die
        # Wiederherstellung spielt projects\<name>\memory aus dem Paket ein.
        # Liegt dasselbe Projekt auf beiden PCs am gleichen Pfad (identischer
        # Ordnername), wuerde PC-2-Auto-Memory sonst OHNE Sicherung
        # ueberschrieben - PC 2 ist in Benutzung, das waere Datenverlust.
        $projDirPc2 = Join-Path $ClaudeDir "projects"
        if (Test-Path $projDirPc2) {
            Get-ChildItem $projDirPc2 -Directory | ForEach-Object {
                $mem = Join-Path $_.FullName "memory"
                if (Test-Path $mem) {
                    $memZiel = Join-Path $sicherungsOrdner ("dot-claude\projects\" + $_.Name + "\memory")
                    robocopy $mem $memZiel /E /R:1 /W:1 | Out-Null
                    if ($LASTEXITCODE -ge 8) {
                        $sicherungOk = $false
                        Melde-Fehler ("Wegsicherung der Auto-Memory von '" + $_.Name + "' fehlgeschlagen (robocopy-Code $LASTEXITCODE) - Wiederherstellung wird uebersprungen, nichts wurde ueberschrieben.")
                    }
                }
            }
        }
    }
    if ($sicherungOk) {
        # Sicherheitsnetz: .credentials.json wird auch beim Import ausgeschlossen,
        # falls sie wider Erwarten im Paket liegt.
        # ERSTLAUF vs. ERNEUTER LAUF (Marker-Datei):
        #  - Erstlauf: OHNE /XO kopieren. Ziel ist 'gleiches Claude-Code-Setup' -
        #    der PC-1-Stand soll ankommen, auch wenn PC-2-Dateien (settings.json,
        #    CLAUDE.md) zufaellig neuere Zeitstempel haben. Gefahrlos, weil die
        #    komplette PC-2-Konfiguration inkl. Auto-Memory soeben gesichert wurde.
        #  - Erneuter Lauf: MIT /XO, damit zwischenzeitliche Aenderungen auf PC 2
        #    nicht mit dem alten Exportstand ueberschrieben werden. Uebersprungene
        #    Dateien werden gezaehlt und im Report genannt (ehrlich statt pauschal
        #    'wiederhergestellt' zu melden).
        $restoreMarker = Join-Path $LogOrdner "restore-erfolgt.txt"
        if (-not (Test-Path $restoreMarker)) {
            robocopy $paketDotClaude $ClaudeDir /E /R:1 /W:1 /XF .credentials.json | Out-Null
            if ($LASTEXITCODE -ge 8) {
                Melde-Fehler "robocopy-Fehler beim Wiederherstellen von .claude (Code $LASTEXITCODE)"
            } else {
                @("Erstmalige .claude-Wiederherstellung am " + (Get-Date).ToString("s"),
                  "PC-2-Sicherung: " + (Join-Path $sicherungsOrdner "dot-claude")) |
                    Set-Content -Path $restoreMarker -Encoding UTF8
                Write-Host "  .claude wiederhergestellt (PC-1-Stand: Settings, CLAUDE.md, Skills, Agents, Auto-Memory)."
                Melde-Hinweis ("Erstlauf: Der PC-1-Stand von .claude wurde vollstaendig uebernommen. Der vorherige PC-2-Stand (inkl. Auto-Memory) liegt zum Abgleich unter: " + (Join-Path $sicherungsOrdner "dot-claude"))
            }
        } else {
            # Vorab ermitteln, welche Dateien auf PC 2 NEUER sind als im Export
            # (robocopy-Trockenlauf in Gegenrichtung: /XO + /XL listet genau die
            # Dateien, deren PC-2-Version neuer ist als die Paket-Version).
            $neuerAufPc2 = @(robocopy $ClaudeDir $paketDotClaude /E /XO /XL /L /NJH /NJS /NDL /NP /XF .credentials.json | Where-Object { $_ -and $_.Trim() })
            robocopy $paketDotClaude $ClaudeDir /E /XO /R:1 /W:1 /XF .credentials.json | Out-Null
            if ($LASTEXITCODE -ge 8) {
                Melde-Fehler "robocopy-Fehler beim Wiederherstellen von .claude (Code $LASTEXITCODE)"
            } else {
                Write-Host "  .claude aktualisiert (nur Dateien, die im Export neuer sind - /XO schuetzt PC-2-Aenderungen)."
                if ($neuerAufPc2.Count -gt 0) {
                    Add-Content -Path $LogDatei -Value ("--- Auf PC 2 neuer als der Export, deshalb NICHT ueberschrieben (" + (Get-Date).ToString("s") + ") ---")
                    $neuerAufPc2 | Add-Content -Path $LogDatei
                    Melde-Hinweis ("{0} Datei(en) in .claude sind auf PC 2 neuer als der Export und wurden NICHT ueberschrieben (Liste: {1}). Zum manuellen Abgleich: Paket unter {2}, PC-2-Sicherung unter {3}." -f $neuerAufPc2.Count, $LogDatei, $paketDotClaude, (Join-Path $sicherungsOrdner "dot-claude"))
                }
            }
        }
    }
} else {
    Melde-Fehler "dot-claude fehlt im Migrationspaket - Claude-Konfiguration nicht wiederhergestellt."
}

# Globale MCP-Server in ~\.claude.json ECHT mergen: vorhandene Server auf
# PC 2 (inkl. dort frisch eingetragener Zugangsdaten) bleiben unangetastet,
# nur fehlende werden ergaenzt. Login-Session und Trust-Entscheidungen
# entstehen frisch auf PC 2.
$mcpDatei = $null
if ($TransferPfad) { $mcpDatei = Join-Path $TransferPfad "mcp-servers.json" }
if ($mcpDatei -and (Test-Path $mcpDatei)) {
    try {
        $mcp = Get-Content $mcpDatei -Raw | ConvertFrom-Json
        if (Test-Path $ClaudeJson) {
            # Wegsicherung VOR dem Merge (PC 2 ist in Benutzung): die
            # bestehende .claude.json in den datierten Sicherungsordner kopieren.
            New-Item -ItemType Directory -Force -Path $sicherungsOrdner | Out-Null
            Copy-Item $ClaudeJson (Join-Path $sicherungsOrdner "claude.json-vor-merge") -Force
            $ziel = Get-Content $ClaudeJson -Raw | ConvertFrom-Json
        } else {
            $ziel = New-Object PSObject
        }
        if (-not ($ziel.PSObject.Properties.Name -contains "mcpServers") -or -not $ziel.mcpServers) {
            $ziel | Add-Member -MemberType NoteProperty -Name mcpServers -Value (New-Object PSObject) -Force
        }
        $ergaenzt = 0
        foreach ($prop in $mcp.PSObject.Properties) {
            if (-not ($ziel.mcpServers.PSObject.Properties.Name -contains $prop.Name)) {
                $ziel.mcpServers | Add-Member -MemberType NoteProperty -Name $prop.Name -Value $prop.Value
                $ergaenzt++
            }
        }
        # BEWUSST ohne BOM schreiben - Claude Code liest die Datei als JSON
        [System.IO.File]::WriteAllText($ClaudeJson, ($ziel | ConvertTo-Json -Depth 50), (New-Object System.Text.UTF8Encoding($false)))
        Write-Host ("  MCP-Server gemerged: {0} neu uebernommen, bestehende Eintraege auf PC 2 unveraendert." -f $ergaenzt)
        # Secret-Hygiene: mcp-servers.json kann API-Keys aus env-Bloecken
        # enthalten -> direkt nach erfolgreichem Merge aus dem Paket loeschen.
        Remove-Item $mcpDatei -Force -ErrorAction SilentlyContinue
        Melde-Hinweis "mcp-servers.json wurde nach dem Merge automatisch aus dem Migrationspaket geloescht (kann API-Keys enthalten)."
    } catch {
        Melde-Fehler ("MCP-Merge fehlgeschlagen: " + $_.Exception.Message)
    }
}

# .gitconfig: NUR uebernehmen, wenn auf PC 2 noch keine existiert.
# Sonst wuerde jeder erneute Lauf zwischenzeitliche git-config-Aenderungen
# auf PC 2 still mit dem alten Exportstand ueberschreiben (im Widerspruch
# zur Idempotenz-Zusage).
$gitconfigZiel = Join-Path $env:USERPROFILE ".gitconfig"
if ($TransferPfad -and (Test-Path (Join-Path $TransferPfad "gitconfig.txt"))) {
    if (-not (Test-Path $gitconfigZiel)) {
        Copy-Item (Join-Path $TransferPfad "gitconfig.txt") $gitconfigZiel -Force
        Write-Host "  .gitconfig uebernommen (Export-Fassung mit maskierten Zugangsdaten - GitHub-Auth stellt der Git Credential Manager per Browser-Login neu her)."
    } else {
        Write-Host "  .gitconfig existiert bereits auf PC 2 - nicht ueberschrieben (gewollt bei erneutem Lauf)."
    }
}

# ---------------------------------------------------------------
# Schritt 6: Second Brain einrichten (identischer Pfad wie auf PC 1)
# ---------------------------------------------------------------
Write-Host "--- Schritt 6: Second Brain einrichten ($VaultPfad) ---"
New-Item -ItemType Directory -Force -Path $VaultPfad | Out-Null
# Befuellt-Pruefung: die .stignore NICHT mitzaehlen. Sonst wuerde ein
# frueherer, fehlgeschlagener Lauf (leerer Ordner, in dem nur die .stignore
# liegt) beim naechsten Lauf faelschlich als 'befuellt' gelten, der
# Startstand-Import wuerde uebersprungen und der Vault bliebe leer.
$schonBefuellt = ((Get-ChildItem -Path $VaultPfad -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne ".stignore" } | Measure-Object).Count -gt 0)
$vaultBefuellt = $schonBefuellt
$vaultKopie = $null
if ($TransferPfad) { $vaultKopie = Join-Path $TransferPfad "vault-kopie" }
# Marker aus dem Export auswerten: Vault wurde auf PC 1 nicht gefunden
if ($TransferPfad -and (Test-Path (Join-Path $TransferPfad "VAULT-FEHLT.txt"))) {
    Melde-Fehler "Export meldet: Vault wurde auf PC 1 NICHT gefunden (VAULT-FEHLT.txt im Paket). Auf PC 1 VaultQuellPfad korrigieren, export-pc1.ps1 erneut ausfuehren, dann dieses Skript nochmal starten. Syncthing NICHT vorher koppeln!"
}
if ($vaultKopie -and (Test-Path $vaultKopie) -and (-not $schonBefuellt)) {
    # /XO: nie aeltere Paket-Dateien ueber neuere lokale Dateien kopieren
    robocopy $vaultKopie $VaultPfad /E /XO /R:1 /W:2 /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Melde-Fehler "robocopy-Fehler beim Vault-Import (Code $LASTEXITCODE)"
    } else {
        Write-Host "  Vault-Startstand nach $VaultPfad kopiert."
        $vaultBefuellt = $true
    }
} elseif ($schonBefuellt) {
    Write-Host "  $VaultPfad enthaelt bereits Dateien - Startstand-Import uebersprungen (gewollt bei erneutem Lauf)."
} else {
    Melde-Fehler "vault-kopie fehlt im Migrationspaket - Second Brain wurde NICHT befuellt. export-pc1.ps1 auf PC 1 pruefen/erneut ausfuehren, dann setup-pc2.ps1 nochmal starten. Syncthing NICHT mit leerem Ordner koppeln!"
}
# Geraetespezifische Obsidian-Dateien vom Sync ausnehmen. Die .stignore wird
# BEWUSST erst nach erfolgreichem Befuellen geschrieben - eine .stignore im
# ansonsten leeren Ordner wuerde spaetere Laeufe in die Irre fuehren (s. o.).
if ($vaultBefuellt) {
    $stignore = Join-Path $VaultPfad ".stignore"
    if (-not (Test-Path $stignore)) {
        @("// Geraetespezifische Obsidian-Dateien nicht synchronisieren",
          ".obsidian/workspace.json",
          ".obsidian/workspace-mobile.json",
          ".trash") | Set-Content -Path $stignore -Encoding UTF8
    }
}
# Firewall fuer Syncthing (LAN-Sync: TCP 22000, UDP 22000 + 21027 Discovery)
if (-not (Get-NetFirewallRule -DisplayName "Syncthing TCP" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Syncthing TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22000 -Profile Domain,Private | Out-Null
}
if (-not (Get-NetFirewallRule -DisplayName "Syncthing UDP" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Syncthing UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 22000,21027 -Profile Domain,Private | Out-Null
}
Melde-Hinweis "Syncthing-Kopplung PC1<->PC2 einmalig durchklicken (PLAN.md, Block 2, Schritt 10) - erst wenn $VaultPfad befuellt ist. Relay/globale Erkennung anlassen (Laptop unterwegs). Laedt http://127.0.0.1:8384 auf einem PC nicht: Syncthing dort einmal ueber das Startmenue starten (oder ab-/anmelden)."

# ---------------------------------------------------------------
# Schritt 7: Taegliches Backup Vault UND Projekte -> NAS (Beschluss
# laut Dossier: 'Vault + Projekte naechtlich aufs NAS'; datierte
# Ordner, VERSIONIERT statt Spiegel - bewusst KEIN /MIR: ein Mirror
# repliziert einen Trojaner bzw. eine Massenloeschung sofort ins Backup).
# Projektquellen: $ProjekteBackupQuellen (Variablenblock); Ziel je Quelle
# <Eltern von $backupWurzel>\Projekte\<Ordnername>\<Datum> - haengt damit
# an derselben Umstiegs-Variable $BackupZielWurzel.
# Die EX2 Ultra ist dabei nur INTERIMS-Backupziel; beim Umstieg auf die
# Synology DS925+ wird NUR $BackupZielWurzel geaendert (Variablenblock).
# Der Task gehoert auf PC 2 (Threadripper: stationaer, selbes LAN wie
# die EX2) - auf PC 1 (Laptop) hoechstens optional, siehe PLAN.md.
# Geplante Aufgaben sehen keine Netzlaufwerksbuchstaben, deshalb
# arbeitet das Backup-Skript mit dem UNC-Pfad; die in Schritt 1
# gespeicherten Anmeldedaten greifen automatisch. Die Aufgabe laeuft
# als 'nur bei angemeldetem Benutzer' (noetig, damit die im
# Anmeldeinformations-Manager gespeicherten NAS-Credentials greifen);
# ein Anmelde-Trigger holt verpasste Laeufe nach (Nachholstart, falls
# der Rechner zur Backup-Zeit aus war).
# ---------------------------------------------------------------
Write-Host "--- Schritt 7: Backup-Aufgabe einrichten ---"
# Backup-Ziel aufloesen: $BackupZielWurzel ist DIE eine Umstiegs-Variable.
$backupWurzel = $BackupZielWurzel
if ([string]::IsNullOrWhiteSpace($backupWurzel) -and $NasHost -ne "") {
    $backupWurzel = "\\$NasHost\$NasShare\Backup\SecondBrain"
}
if (-not [string]::IsNullOrWhiteSpace($backupWurzel)) {
    try {
        # Projekte-Backup-Wurzel aus derselben Umstiegs-Variable ableiten:
        # Standard \\NAS\share\Backup\SecondBrain -> \\NAS\share\Backup\Projekte
        $backupEltern = Split-Path $backupWurzel -Parent
        if ([string]::IsNullOrWhiteSpace($backupEltern)) {
            $projekteWurzel = ($backupWurzel + "-Projekte")
        } else {
            $projekteWurzel = Join-Path $backupEltern "Projekte"
        }
        # Erinnerung (Beschluss: Vault UND Projekte sichern): Ohne eingetragene
        # Projektquellen sichert der Task nur den Vault - das soll nicht still
        # so bleiben, deshalb landet es als Punkt im Report.
        if (@($ProjekteBackupQuellen).Count -eq 0) {
            Melde-Fehler "ProjekteBackupQuellen ist leer - laut Beschluss sollen Vault UND Projekte naechtlich aufs NAS. Nach dem Klonen der Repos (PLAN.md, Restliste Punkt 19) die Repo-Wurzeln in ProjekteBackupQuellen eintragen (siehe repo-liste.txt) und setup-pc2.ps1 erneut laufen lassen."
        }
        $skriptOrdner = "C:\Skripte"
        New-Item -ItemType Directory -Force -Path $skriptOrdner | Out-Null
        $backupSkriptPfad = Join-Path $skriptOrdner "Backup-SecondBrain.ps1"
        $vorlage = @'
# Backup-SecondBrain.ps1 - automatisch erzeugt von setup-pc2.ps1
# Sichert Vault UND Projektordner taeglich in datierte Ordner auf dem NAS
# (Beschluss: 'Vault + Projekte naechtlich aufs NAS').
# VERSIONIERT (datierte Tagesstaende), bewusst KEIN /MIR-Spiegel.
# Aktuelles Ziel: WD My Cloud EX2 Ultra (INTERIM). Nach dem Umstieg auf
# die Synology DS925+ erzeugt setup-pc2.ps1 dieses Skript mit dem neuen
# Ziel neu (nur $BackupZielWurzel im Variablenblock aendern, Skript erneut laufen lassen).
$VaultPfad        = "__VAULTPFAD__"
$BackupWurzel     = "__BACKUPWURZEL__"
$ProjekteWurzel   = "__PROJEKTEWURZEL__"
$ProjekteQuellen  = @(__PROJEKTQUELLEN__)
$AufbewahrungTage = __TAGE__
$LogDatei  = Join-Path $env:LOCALAPPDATA "SecondBrain-Backup.log"
# Erreichbarkeitspruefung: Ist das NAS nicht erreichbar (Rechner unterwegs,
# NAS aus), wird der Lauf sauber uebersprungen (Exit 0, kein Fehlerspam) -
# der naechste Trigger (taeglich bzw. Anmeldung) holt das Backup nach.
$freigabe = $BackupWurzel
if ($BackupWurzel -match '^(\\\\[^\\]+\\[^\\]+)') { $freigabe = $Matches[1] }
if (-not (Test-Path $freigabe)) {
    Add-Content -Path $LogDatei -Value ("UEBERSPRUNGEN: NAS-Freigabe '" + $freigabe + "' nicht erreichbar am " + (Get-Date) + " - Backup wird beim naechsten Trigger nachgeholt.")
    exit 0
}
function Sichere-Versioniert([string]$Quelle, [string]$ZielWurzel) {
    # Wachklausel 1: NIEMALS eine leere Quelle sichern. Eine leere Quelle
    # (fehlgeschlagenes Setup, versehentliche Massenloeschung, die Syncthing
    # propagiert hat) wuerde sonst taeglich 'erfolgreich' leer gesichert und
    # die Aufbewahrung wuerde alle brauchbaren Staende wegrotieren - das
    # Backup als letzte Verteidigungslinie darf sich nicht selbst vernichten.
    if (-not (Get-ChildItem -Path $Quelle -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Add-Content -Path $LogDatei -Value ("ABBRUCH: Quelle '" + $Quelle + "' ist leer am " + (Get-Date) + " - weder gesichert noch alte Staende geloescht.")
        return $false
    }
    # Wachklausel 2 (Eigentums-Nachweis): Rotiert wird NUR in Ordnern, die
    # dieses Skript selbst verwaltet - erkennbar an der Marker-Datei unten.
    # Existiert $ZielWurzel bereits MIT datumsbenannten Unterordnern, aber
    # OHNE Marker, ist das Ziel offensichtlich ein FREMDER Ordner (z.B. ein
    # nach Drehdatum organisiertes Archiv wie '2024-05-13') - dann harter
    # Abbruch statt Rotation: Remove-Item wuerde dort unwiederbringlich
    # Archivordner loeschen (der EX2-Papierkorb ist laut Beschluss AUS).
    $marker = Join-Path $ZielWurzel "_von-SecondBrain-Backup-verwaltet.txt"
    if (-not (Test-Path $ZielWurzel)) {
        New-Item -ItemType Directory -Force -Path $ZielWurzel | Out-Null
        Set-Content -Path $marker -Value ("Dieser Ordner wird von Backup-SecondBrain.ps1 verwaltet (angelegt am " + (Get-Date) + "). Datumsordner aelter als die Aufbewahrungsfrist werden hier automatisch geloescht - KEINE eigenen Ordner ablegen!")
    } elseif (-not (Test-Path $marker)) {
        $fremdeDatumsOrdner = @(Get-ChildItem -Path $ZielWurzel -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' })
        if ($fremdeDatumsOrdner.Count -gt 0) {
            Add-Content -Path $LogDatei -Value ("ABBRUCH: Ziel '" + $ZielWurzel + "' existiert bereits mit datumsbenannten Unterordnern, aber OHNE Marker-Datei - vermutlich ein FREMDER Ordner (BackupZielWurzel pruefen!). Weder gesichert noch rotiert am " + (Get-Date) + ". Nur wenn die Datumsordner SICHER von diesem Backup stammen: die Datei '_von-SecondBrain-Backup-verwaltet.txt' dort von Hand anlegen.")
            return $false
        }
        Set-Content -Path $marker -Value ("Dieser Ordner wird von Backup-SecondBrain.ps1 verwaltet (uebernommen am " + (Get-Date) + "). Datumsordner aelter als die Aufbewahrungsfrist werden hier automatisch geloescht - KEINE eigenen Ordner ablegen!")
    }
    $zielHeute = Join-Path $ZielWurzel (Get-Date -Format 'yyyy-MM-dd')
    New-Item -ItemType Directory -Force -Path $zielHeute | Out-Null
    # Grosse Render-/Cache-Ordner bei Bedarf hier per /XD ergaenzen (Groesse
    # vorher z.B. mit WizTree pruefen - jeder Tagesstand ist eine VOLLKOPIE,
    # 30 Staende grosser Projektordner koennen die 2-Bay-EX2 fuellen).
    robocopy $Quelle $zielHeute /E /FFT /R:2 /W:5 /NP /NDL /XD ".stversions" ".trash" "node_modules" /LOG+:$LogDatei | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Add-Content -Path $LogDatei -Value ("FEHLER: robocopy-Endcode {0} fuer '{1}' am {2}" -f $LASTEXITCODE, $Quelle, (Get-Date))
        return $false
    }
    # Abschluss-Marker in den Tagesordner: Nur Datumsordner MIT dieser Datei
    # sind vollstaendige Staende - ein mittendrin abgebrochener Lauf
    # hinterlaesst keinen Marker und ist so sofort erkennbar.
    Set-Content -Path (Join-Path $zielHeute "_BACKUP-OK.txt") -Value ("Backup vollstaendig abgeschlossen am " + (Get-Date))
    # Aufbewahrung erst NACH erfolgreichem Lauf und NUR mit Eigentums-Marker:
    # nur die letzten N Tagesstaende behalten.
    if (Test-Path $marker) {
        Get-ChildItem -Path $ZielWurzel -Directory |
            Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
            Sort-Object Name -Descending |
            Select-Object -Skip $AufbewahrungTage |
            ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force }
    }
    return $true
}
$gesamtOk = $true
# 1) Vault
if (-not (Sichere-Versioniert $VaultPfad $BackupWurzel)) { $gesamtOk = $false }
# 2) Projekte: jede Quelle versioniert unter <ProjekteWurzel>\<Ordnername>\<Datum>
foreach ($quelle in $ProjekteQuellen) {
    if (-not (Test-Path $quelle)) {
        Add-Content -Path $LogDatei -Value ("UEBERSPRUNGEN: Projektquelle '" + $quelle + "' nicht vorhanden am " + (Get-Date) + ".")
        continue
    }
    $name = Split-Path $quelle -Leaf
    if (-not $name) { $name = ($quelle -replace '[:\\/]', '') }
    if (-not (Sichere-Versioniert $quelle (Join-Path $ProjekteWurzel $name))) { $gesamtOk = $false }
}
if ($gesamtOk) { exit 0 }
exit 1
'@
        $projektQuellenText = ""
        if (@($ProjekteBackupQuellen).Count -gt 0) {
            $projektQuellenText = '"' + ((@($ProjekteBackupQuellen) | ForEach-Object { "$_" -replace '"', '' }) -join '", "') + '"'
        }
        $vorlage = $vorlage.Replace("__VAULTPFAD__", $VaultPfad).Replace("__BACKUPWURZEL__", $backupWurzel).Replace("__PROJEKTEWURZEL__", $projekteWurzel).Replace("__PROJEKTQUELLEN__", $projektQuellenText).Replace("__TAGE__", [string]$AufbewahrungTage)
        Set-Content -Path $backupSkriptPfad -Value $vorlage -Encoding UTF8

        $aktion    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupSkriptPfad`""
        # Zwei Ausloeser: taeglich um $BackupUhrzeit UND bei jeder Anmeldung.
        # Grund: Ohne angemeldeten Benutzer laeuft die Aufgabe nicht, und
        # -StartWhenAvailable holt DIESEN Fall nicht nach - der Anmelde-Trigger
        # schon. Das Backup-Skript ist durch datierte Tagesordner idempotent
        # (zweiter Lauf am selben Tag kopiert nur Deltas).
        $ausloeser = @((New-ScheduledTaskTrigger -Daily -At $BackupUhrzeit), (New-ScheduledTaskTrigger -AtLogOn))
        # KEIN knappes Zeitlimit: Jeder Tagesstand ist eine VOLLKOPIE - grosse
        # Videoprojekt-Ordner brauchen auf die EX2 (60-110 MB/s) leicht mehrere
        # Stunden. Ein 1-Stunden-Limit wuerde robocopy mitten im Lauf killen
        # und unvollstaendige Staende hinterlassen, die wie gueltige aussehen.
        # 12 Stunden = grosszuegige Obergrenze gegen echte Haenger.
        $optionen  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12)
        # -Force macht den Aufruf idempotent (ueberschreibt eine vorhandene Aufgabe gleichen Namens)
        Register-ScheduledTask -TaskName "SecondBrain-Backup" -Action $aktion -Trigger $ausloeser -Settings $optionen -Force | Out-Null
        Write-Host "  Aufgabe 'SecondBrain-Backup' registriert (taeglich $BackupUhrzeit + Nachhol-Lauf bei Anmeldung; laeuft nur bei angemeldetem Benutzer; ueberspringt sauber, wenn das NAS nicht erreichbar ist; bricht bei leerer Quelle bewusst ab)."
        Write-Host "  Backup-Ziele (versioniert, Interim EX2 Ultra): $backupWurzel (Vault) und $projekteWurzel (Projekte, Quellen: $(@($ProjekteBackupQuellen).Count) eingetragen)."
    } catch {
        Melde-Fehler ("Backup-Aufgabe konnte nicht angelegt werden: " + $_.Exception.Message)
    }
} else {
    Melde-Hinweis "Kein NAS konfiguriert (NasHost und BackupZielWurzel leer) - Backup-Aufgabe nicht angelegt."
}

# ---------------------------------------------------------------
# Schritt 8: Windows-Grundeinstellungen (optional, idempotent)
# Standard AUS ($WindowsGrundeinstellungen = $false): PC 2 ist schon in
# Benutzung - Energie-/Explorer-Einstellungen werden nur nach bewusstem
# Opt-in geaendert, und vorher wird der alte Zustand gesichert.
# Standard-Apps/Dateizuordnungen bewusst NICHT per Skript (Windows 11
# schuetzt das) - siehe manuelle Restliste im PLAN.md.
# ---------------------------------------------------------------
if ($WindowsGrundeinstellungen) {
    Write-Host "--- Schritt 8: Windows-Grundeinstellungen ---"
    try {
        $ExplorerKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
        # VORHER-Zustand sichern (wiederherstellbar machen): aktiver
        # Energiesparplan + die drei Explorer-Registry-Werte in den
        # datierten Sicherungsordner dieses Laufs schreiben.
        $einstellungenSicherung = Join-Path $LogOrdner ("windows-einstellungen-vorher-" + $sicherungsStempel + ".txt")
        $vorher = @("=== Windows-Einstellungen VOR setup-pc2 (" + (Get-Date).ToString("s") + ") ===", "")
        $alteEapWg = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $vorher += "Aktiver Energiesparplan (powercfg /getactivescheme):"
        $vorher += ((powercfg /getactivescheme 2>$null | Out-String).Trim())
        $ErrorActionPreference = $alteEapWg
        $vorher += ""
        $vorher += "Explorer-Registry-Werte unter $ExplorerKey :"
        $vorherWerte = Get-ItemProperty -Path $ExplorerKey -ErrorAction SilentlyContinue
        foreach ($wertName in @("HideFileExt", "Hidden", "LaunchTo")) {
            $wert = "(nicht gesetzt)"
            if ($vorherWerte -and ($vorherWerte.PSObject.Properties.Name -contains $wertName)) {
                $wert = [string]$vorherWerte.$wertName
            }
            $vorher += ("  {0} = {1}" -f $wertName, $wert)
        }
        $vorher += ""
        $vorher += "Hinweis: Die Standby-/Disk-Timeouts des vorherigen Plans stecken im oben genannten Energiesparplan - 'powercfg /setactive <GUID von oben>' stellt ihn komplett wieder her."
        $vorher | Out-File -FilePath $einstellungenSicherung -Encoding UTF8
        $vorher | Out-File -FilePath $LogDatei -Append -Encoding UTF8
        Melde-Hinweis ("Windows-Grundeinstellungen wurden geaendert (bewusstes Opt-in). Vorherige Werte gesichert unter: " + $einstellungenSicherung)

        Set-ItemProperty -Path $ExplorerKey -Name HideFileExt -Value 0 -Type DWord   # Dateiendungen anzeigen
        Set-ItemProperty -Path $ExplorerKey -Name Hidden      -Value 1 -Type DWord   # versteckte Dateien anzeigen
        Set-ItemProperty -Path $ExplorerKey -Name LaunchTo    -Value 1 -Type DWord   # Explorer startet in 'Dieser PC'
        powercfg /setactive SCHEME_MIN | Out-Null            # Hoechstleistung
        powercfg /change standby-timeout-ac 0 | Out-Null
        powercfg /change hibernate-timeout-ac 0 | Out-Null
        powercfg /change disk-timeout-ac 0 | Out-Null
        powercfg /change monitor-timeout-ac 15 | Out-Null
        Write-Host "  Explorer- und Energieeinstellungen gesetzt (greifen spaetestens nach Ab-/Anmelden)."
    } catch {
        Melde-Fehler ("Windows-Grundeinstellungen teilweise fehlgeschlagen: " + $_.Exception.Message)
    }
}

# ---------------------------------------------------------------
# Schritt 9: Infodateien sichern + Abschlussreport
# ---------------------------------------------------------------
Write-Host "--- Schritt 9: Infodateien sichern + Abschlussreport ---"
# Unkritische Infodateien aus dem Migrationspaket nach %LOCALAPPDATA%\pc2-setup
# kopieren (alle maskiert bzw. secret-frei): Sie werden auch NACH dem Loeschen
# des Pakets noch gebraucht - repo-liste.txt fuers Klonen und fuer
# ProjekteBackupQuellen, graphify-info.txt fuer die graphify-Nachinstallation,
# programme-komplett.txt fuer die GPU-Treiberversion, manifest.json und
# import-fehlgeschlagen.txt fuer die Verifikation (PLAN.md, Abschnitt 8).
# Ohne diese Kopien wuerde 'Migrationspaket loeschen' die Infos vernichten.
if ($TransferPfad -and (Test-Path $TransferPfad)) {
    $infoDateien = @("repo-liste.txt", "graphify-info.txt", "programme-komplett.txt",
                     "nicht-automatisch.txt", "oem-hinweise.txt", "import-fehlgeschlagen.txt",
                     "manifest.json", "vault-auswahl.txt", "projekt-konfig-fundliste.txt",
                     "export-warnungen.txt")
    $kopiert = 0
    foreach ($info in $infoDateien) {
        $infoQuelle = Join-Path $TransferPfad $info
        if (Test-Path $infoQuelle) {
            Copy-Item $infoQuelle (Join-Path $LogOrdner $info) -Force -ErrorAction SilentlyContinue
            $kopiert++
        }
    }
    if ($kopiert -gt 0) {
        Melde-Hinweis ("{0} Infodatei(en) des Migrationspakets (repo-liste.txt, graphify-info.txt, programme-komplett.txt, manifest.json usw.) liegen als Kopie unter {1} - das Migrationspaket kann daher nach der Verifikation gefahrlos komplett geloescht werden." -f $kopiert, $LogOrdner)
    }
}
$report = @()
$report += ("=== setup-pc2 Report vom " + (Get-Date).ToString("s") + " ===")
$report += ""
if ($Fehler.Count -eq 0) {
    $report += "Keine Fehler - alle automatischen Schritte waren erfolgreich."
} else {
    $report += ("FEHLGESCHLAGEN ({0} Punkt(e)) - bitte nacharbeiten:" -f $Fehler.Count)
    foreach ($f in $Fehler) { $report += (" - " + $f) }
    $report += "Tipp: Neustart und setup-pc2.ps1 erneut ausfuehren (idempotent) behebt vieles."
}
$report += ""
$report += "Naechste manuelle Schritte (Details in PLAN.md):"
$report += " 1. Neues Terminal oeffnen, 'claude' starten -> Browser-Login mit dem Claude-Konto (Abo/OAuth)."
$report += " 2. 'claude doctor' und 'claude mcp list' ausfuehren; MCP-OAuth-Server per /mcp anmelden."
$report += " 3. Tailscale starten und mit dem Tailscale-Konto anmelden (beide PCs im selben Tailnet)."
$report += " 4. Syncthing koppeln: http://127.0.0.1:8384 auf beiden PCs (Klick-Anleitung in PLAN.md);"
$report += "    Relay/globale Erkennung eingeschaltet LASSEN (Laptop synct dann auch unterwegs)."
$report += "    WICHTIG: Nur koppeln, wenn $VaultPfad befuellt ist (siehe etwaige Fehler oben)."
$report += "    Laedt die Seite auf einem PC nicht: Syncthing dort einmal ueber das Startmenue starten"
$report += "    (oder ab- und wieder anmelden), dann neu laden."
$report += " 5. Obsidian auf PC 2 oeffnen -> 'Anderen Vault oeffnen' -> C:\SecondBrain als Vault oeffnen"
$report += "    (PLAN.md, Block 2, Schritt 11; falls Obsidian fehlt: winget install --id Obsidian.Obsidian -e)."
$report += " 6. nicht-automatisch.txt und ggf. import-fehlgeschlagen.txt durchsehen."
$report += " 7. Manuelle Restliste im PLAN.md abarbeiten (Adobe CC 2-Geraete-Limit, Cinema 4D/Maxon,"
$report += "    ArchiCAD, Topaz, DaVinci, D5 Render 3-Geraete-Check + GPU-Check, Postshot,"
$report += "    FreeFileSync Business, Bitwarden, graphify laut graphify-info.txt, Treiber, Logins)."
$report += " 8. Einmal 'winget upgrade --all' ausfuehren."
$report += " 9. WICHTIG (als LETZTER Schritt, nach Restliste und Verifikation): restliches"
$report += "    Migrationspaket loeschen - am einfachsten den Ordner"
$report += ("    '" + $TransferUnterordner + "' auf der NAS-Freigabe bzw. dem USB-Stick im Explorer loeschen.")
$report += "    (mcp-servers.json wurde - falls vorhanden - nach dem Merge bereits automatisch geloescht."
$report += ("     Die Infodateien repo-liste.txt, graphify-info.txt, programme-komplett.txt, manifest.json usw.")
$report += ("     liegen als Kopie unter " + $LogOrdner + " und bleiben nach dem Loeschen erhalten.)")
if ($TransferPfad -and ((Split-Path $TransferPfad -Leaf) -eq $TransferUnterordner)) {
    # Loeschbefehl nur ausgeben, wenn der Pfad sicher auf den Unterordner zeigt
    # (nie auf die Freigabe-Wurzel).
    $report += ("    Alternativ per PowerShell: Remove-Item '" + $TransferPfad + "' -Recurse -Force")
}
if ($Hinweise.Count -gt 0) {
    $report += ""
    foreach ($h in $Hinweise) { $report += (" Hinweis: " + $h) }
}

$reportPfad = Join-Path $LogOrdner "setup-report.txt"
$report | Out-File -FilePath $reportPfad -Encoding UTF8
if ($TransferPfad -and (Test-Path $TransferPfad)) {
    Copy-Item $reportPfad (Join-Path $TransferPfad "setup-report.txt") -Force -ErrorAction SilentlyContinue
}
Write-Host ""
foreach ($zeile in $report) { Write-Host $zeile }
Write-Host ""
Write-Host ("Report gespeichert unter: " + $reportPfad) -ForegroundColor Green
