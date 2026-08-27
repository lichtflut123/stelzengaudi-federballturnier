# ============================================================
# setup-pc2.ps1
# Laeuft auf PC 2 - ALS ADMINISTRATOR ausfuehren, und zwar aus dem
# taeglich genutzten Windows-Konto heraus (siehe PLAN.md, Abschnitt 2).
#
# Richtet PC 2 identisch zu PC 1 ein:
#   1. NAS als Netzlaufwerk (cmdkey + net use, Autostart-Reparatur)
#   2. Migrationspaket vom NAS (Fallback USB) suchen
#   3. Grundwerkzeuge: Git, Node LTS, Claude Code, Syncthing
#   4. Alle Programme aus apps.json (3 Stufen mit Nachkontrolle)
#   5. Claude-Konfiguration wiederherstellen + MCP-Server mergen + .gitconfig
#   6. Second Brain unter $VaultPfad einrichten (Startstand + Firewall)
#   7. Taeglichen Backup-Task (Vault -> NAS, datierte Ordner) anlegen
#   8. Windows-Grundeinstellungen (optional)
#   9. Abschlussreport: was hat NICHT geklappt + naechste Handgriffe
#
# Idempotent: mehrfaches Ausfuehren ist erwuenscht (zieht Reste nach,
# z.B. Pakete, die einen Neustart brauchten). Zwischenzeitliche
# Aenderungen auf PC 2 werden dabei NICHT ueberschrieben (robocopy /XO,
# MCP-Merge ergaenzt nur Fehlendes, .gitconfig wird nur uebernommen,
# wenn noch keine existiert).
# Als UTF-8 mit BOM speichern. Kompatibel mit Windows PowerShell 5.1
# (kein &&, kein ??, keine ternaeren Operatoren).
# Umlaute in Ausgaben bewusst als ae/oe/ue geschrieben.
# Start: powershell -ExecutionPolicy Bypass -File C:\Skripte\setup-pc2.ps1
# ============================================================

# ==================== VARIABLEN (EINMAL AUSFUELLEN) ====================
$NasHost             = "192.168.1.20"    # IP oder Name des NAS (z.B. "DISKSTATION"); "" = kein NAS
$NasShare            = "daten"           # Name der SMB-Freigabe auf dem NAS
$NasUser             = "lichtflut"       # NAS-Benutzerkonto (kein Gastzugriff!)
$Laufwerk            = "N"               # Laufwerksbuchstabe, auf BEIDEN PCs gleich (muss frei sein)
$VaultPfad           = "C:\SecondBrain"  # kanonischer Second-Brain-Pfad (auf BEIDEN PCs gleich)
$TransferUnterordner = "pc2-umzug"       # Ordnername auf der NAS-Freigabe (wie in export-pc1.ps1; NICHT leer lassen!)
$UsbFallbackPfad     = ""                # z.B. "E:\pc2-umzug", falls das Paket auf USB liegt
# --- Voreinstellungen (normalerweise nicht anfassen) ---
$BackupUnterordner         = "Backup\SecondBrain"  # Backup-Zielordner auf der NAS-Freigabe
$AufbewahrungTage          = 30                    # so viele Tagesstaende behaelt das Backup
$BackupUhrzeit             = "21:00"               # taegliche Backup-Uhrzeit
$WindowsGrundeinstellungen = $true                 # Explorer-/Energie-Einstellungen setzen
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
    # Win32-Argumentregel: Backslashes am Passwort-Ende verdoppeln, sonst
    # 'schluckt' der letzte Backslash das schliessende Anfuehrungszeichen
    # und es wird ein falsches Passwort gespeichert.
    $pwArg = $Passwort -replace '(\\+)$', '$1$1'
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
        $eintragVorhanden = cmdkey /list | Select-String -SimpleMatch $NasHost
        if (-not $eintragVorhanden) {
            $cred = Get-Credential -UserName $NasUser -Message "Passwort des NAS-Benutzers '$NasUser' eingeben"
            if ($cred) {
                $pw = $cred.GetNetworkCredential().Password
                $gespeichert = Speichere-NasZugang $NasHost $cred.UserName $pw
                Remove-Variable pw, cred
                if ($gespeichert) {
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
                # Haeufigste Ursache: beim ersten Lauf falsch eingetipptes Passwort
                # gespeichert -> Eintrag verwerfen, neu abfragen, EINMAL wiederholen.
                Write-Warning "  Verbindung fehlgeschlagen - gespeicherte Zugangsdaten werden verworfen, bitte Passwort erneut eingeben."
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
            }
            if ($netExit -ne 0) {
                Melde-Fehler "Laufwerk ${Laufwerk}: konnte nicht mit $UncFreigabe verbunden werden (net use Exit-Code $netExit). Notausgang: 'cmdkey /delete:$NasHost' ausfuehren und Skript neu starten."
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
# Schritt 3: Grundwerkzeuge (Git, Node LTS, Claude Code, Syncthing)
# Claude Code bewusst per winget (ein Update-Weg: winget upgrade --all);
# NICHT zusaetzlich den nativen Installer verwenden (Doppelinstallation).
# ---------------------------------------------------------------
Write-Host "--- Schritt 3: Grundwerkzeuge installieren ---"
foreach ($paket in @("Git.Git", "OpenJS.NodeJS.LTS", "Anthropic.ClaudeCode", "BillStewart.SyncthingWindowsSetup")) {
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
if ($TransferPfad -and (Test-Path (Join-Path $TransferPfad "dot-claude"))) {
    # Sicherheitsnetz: .credentials.json wird auch beim Import ausgeschlossen,
    # falls sie wider Erwarten im Paket liegt.
    # /XO: nie aeltere Paket-Dateien ueber neuere lokale Dateien kopieren -
    # sonst wuerde ein erneuter Lauf zwischenzeitliche Aenderungen auf PC 2
    # (settings.json, CLAUDE.md, Auto-Memory) mit dem alten Exportstand ueberschreiben.
    robocopy (Join-Path $TransferPfad "dot-claude") $ClaudeDir /E /XO /R:1 /W:1 /XF .credentials.json | Out-Null
    if ($LASTEXITCODE -ge 8) {
        Melde-Fehler "robocopy-Fehler beim Wiederherstellen von .claude (Code $LASTEXITCODE)"
    } else {
        Write-Host "  .claude wiederhergestellt (Settings, CLAUDE.md, Skills, Agents, Auto-Memory)."
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
        Write-Host "  .gitconfig uebernommen."
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
Melde-Hinweis "Syncthing-Kopplung PC1<->PC2 einmalig durchklicken (PLAN.md, Block 2, Schritt 8) - erst wenn $VaultPfad befuellt ist. Laedt http://127.0.0.1:8384 auf einem PC nicht: Syncthing dort einmal ueber das Startmenue starten (oder ab-/anmelden)."

# ---------------------------------------------------------------
# Schritt 7: Taegliches Backup Vault -> NAS (datierte Ordner)
# Geplante Aufgaben sehen keine Netzlaufwerksbuchstaben, deshalb
# arbeitet das Backup-Skript mit dem UNC-Pfad; die in Schritt 1
# gespeicherten Anmeldedaten greifen automatisch. Die Aufgabe laeuft
# als 'nur bei angemeldetem Benutzer' (noetig, damit die im
# Anmeldeinformations-Manager gespeicherten NAS-Credentials greifen).
# ---------------------------------------------------------------
Write-Host "--- Schritt 7: Backup-Aufgabe einrichten ---"
if ($NasHost -ne "") {
    try {
        $skriptOrdner = "C:\Skripte"
        New-Item -ItemType Directory -Force -Path $skriptOrdner | Out-Null
        $backupSkriptPfad = Join-Path $skriptOrdner "Backup-SecondBrain.ps1"
        $backupWurzel = "\\$NasHost\$NasShare\$BackupUnterordner"
        $vorlage = @'
# Backup-SecondBrain.ps1 - automatisch erzeugt von setup-pc2.ps1
# Sichert den Vault taeglich in datierte Ordner auf dem NAS.
$VaultPfad        = "__VAULTPFAD__"
$BackupWurzel     = "__BACKUPWURZEL__"
$AufbewahrungTage = __TAGE__
$LogDatei  = Join-Path $env:LOCALAPPDATA "SecondBrain-Backup.log"
# Wachklausel: NIEMALS eine leere Quelle sichern. Ein leerer Vault
# (fehlgeschlagenes Setup, versehentliche Massenloeschung, die Syncthing
# propagiert hat) wuerde sonst taeglich 'erfolgreich' leer gesichert und
# die Aufbewahrung wuerde alle brauchbaren Staende wegrotieren - das
# Backup als letzte Verteidigungslinie darf sich nicht selbst vernichten.
if (-not (Get-ChildItem -Path $VaultPfad -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1)) {
    Add-Content -Path $LogDatei -Value ("ABBRUCH: Vault '" + $VaultPfad + "' ist leer am " + (Get-Date) + " - es wurde weder gesichert noch wurden alte Staende geloescht.")
    exit 1
}
$ZielHeute = Join-Path $BackupWurzel (Get-Date -Format 'yyyy-MM-dd')
New-Item -ItemType Directory -Force -Path $ZielHeute | Out-Null
robocopy $VaultPfad $ZielHeute /E /FFT /R:2 /W:5 /NP /NDL /XD ".stversions" ".trash" /LOG+:$LogDatei | Out-Null
if ($LASTEXITCODE -ge 8) {
    Add-Content -Path $LogDatei -Value ("FEHLER: robocopy-Endcode {0} am {1}" -f $LASTEXITCODE, (Get-Date))
    exit 1
}
# Aufbewahrung erst NACH erfolgreichem Lauf: nur die letzten N Tagesstaende behalten
Get-ChildItem -Path $BackupWurzel -Directory |
    Where-Object { $_.Name -match '^\d{4}-\d{2}-\d{2}$' } |
    Sort-Object Name -Descending |
    Select-Object -Skip $AufbewahrungTage |
    ForEach-Object { Remove-Item -Path $_.FullName -Recurse -Force }
exit 0
'@
        $vorlage = $vorlage.Replace("__VAULTPFAD__", $VaultPfad).Replace("__BACKUPWURZEL__", $backupWurzel).Replace("__TAGE__", [string]$AufbewahrungTage)
        Set-Content -Path $backupSkriptPfad -Value $vorlage -Encoding UTF8

        $aktion    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupSkriptPfad`""
        # Zwei Ausloeser: taeglich um $BackupUhrzeit UND bei jeder Anmeldung.
        # Grund: Ohne angemeldeten Benutzer laeuft die Aufgabe nicht, und
        # -StartWhenAvailable holt DIESEN Fall nicht nach - der Anmelde-Trigger
        # schon. Das Backup-Skript ist durch datierte Tagesordner idempotent
        # (zweiter Lauf am selben Tag kopiert nur Deltas).
        $ausloeser = @((New-ScheduledTaskTrigger -Daily -At $BackupUhrzeit), (New-ScheduledTaskTrigger -AtLogOn))
        $optionen  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1)
        # -Force macht den Aufruf idempotent (ueberschreibt eine vorhandene Aufgabe gleichen Namens)
        Register-ScheduledTask -TaskName "SecondBrain-Backup" -Action $aktion -Trigger $ausloeser -Settings $optionen -Force | Out-Null
        Write-Host "  Aufgabe 'SecondBrain-Backup' registriert (taeglich $BackupUhrzeit + Nachhol-Lauf bei Anmeldung; laeuft nur bei angemeldetem Benutzer; bricht bei leerem Vault bewusst ab)."
    } catch {
        Melde-Fehler ("Backup-Aufgabe konnte nicht angelegt werden: " + $_.Exception.Message)
    }
} else {
    Melde-Hinweis "Kein NAS konfiguriert - Backup-Aufgabe nicht angelegt."
}

# ---------------------------------------------------------------
# Schritt 8: Windows-Grundeinstellungen (optional, idempotent)
# Standard-Apps/Dateizuordnungen bewusst NICHT per Skript (Windows 11
# schuetzt das) - siehe manuelle Restliste im PLAN.md.
# ---------------------------------------------------------------
if ($WindowsGrundeinstellungen) {
    Write-Host "--- Schritt 8: Windows-Grundeinstellungen ---"
    try {
        $ExplorerKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"
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
# Schritt 9: Abschlussreport
# ---------------------------------------------------------------
Write-Host "--- Schritt 9: Abschlussreport ---"
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
$report += " 1. Neues Terminal oeffnen, 'claude' starten -> Browser-Login mit dem Claude-Konto."
$report += " 2. 'claude doctor' und 'claude mcp list' ausfuehren; MCP-OAuth-Server per /mcp anmelden."
$report += " 3. Syncthing koppeln: http://127.0.0.1:8384 auf beiden PCs (Klick-Anleitung in PLAN.md)."
$report += "    WICHTIG: Nur koppeln, wenn $VaultPfad befuellt ist (siehe etwaige Fehler oben)."
$report += "    Laedt die Seite auf einem PC nicht: Syncthing dort einmal ueber das Startmenue starten"
$report += "    (oder ab- und wieder anmelden), dann neu laden."
$report += " 4. nicht-automatisch.txt und ggf. import-fehlgeschlagen.txt im Migrationspaket durchsehen."
$report += " 5. Manuelle Restliste im PLAN.md abarbeiten (Adobe, DaVinci, Resolume, Treiber, Logins)."
$report += " 6. Einmal 'winget upgrade --all' ausfuehren."
$report += " 7. WICHTIG: restliches Migrationspaket loeschen - am einfachsten den Ordner"
$report += ("    '" + $TransferUnterordner + "' auf der NAS-Freigabe bzw. dem USB-Stick im Explorer loeschen.")
$report += "    (mcp-servers.json wurde - falls vorhanden - nach dem Merge bereits automatisch geloescht.)"
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
