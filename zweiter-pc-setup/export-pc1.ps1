# ============================================================
# export-pc1.ps1
# Laeuft auf PC 1 (MSI-Titan-Laptop, normale Benutzerrechte genuegen).
#
# Sammelt alles, was PC 2 (Threadripper) braucht, und legt es als
# Migrationspaket auf dem NAS (WD My Cloud EX2 Ultra) ab (Fallback: USB):
#   apps.json                     winget-Programmliste (autom. Import auf PC 2)
#   programme-komplett.txt        ALLE Programme laut Registry (Sicherheitsnetz)
#   nicht-automatisch.txt         Programme, die winget vermutlich nicht kennt
#   oem-hinweise.txt              vermutlich laptop-/OEM-spezifische Pakete in
#                                 apps.json (VOR dem Import auf PC 2 durchsehen!)
#   export-warnungen.txt          Original-Warnungen von winget export
#   dot-claude\                   Claude-Code-Konfiguration OHNE Secrets
#                                 (Secret-Scan bricht bei Treffern bewusst ab)
#   mcp-servers.json              globale MCP-Server aus %USERPROFILE%\.claude.json
#   gitconfig.txt                 Git-Konfiguration (eingebettete Zugangsdaten/
#                                 Tokens werden beim Schreiben MASKIERT)
#   repo-liste.txt                Git-Repos auf C: UND D: (Pfad + Remote,
#                                 eingebettete Zugangsdaten in URLs maskiert)
#   projekt-konfig-fundliste.txt  CLAUDE.md/.mcp.json in den Repos (Kontrolle)
#   graphify-info.txt             Wie ist graphify auf PC 1 installiert?
#                                 (where.exe graphify + npm list -g)
#   vault-auswahl.txt             Protokoll der Obsidian-Vault-Erkennung
#   vault-kopie\                  Kopie des Second Brain (Startstand fuer PC 2)
#   VAULT-FEHLT.txt               Marker, falls KEIN Vault gefunden wurde
#                                 (setup-pc2.ps1 meldet das als Fehler)
#   manifest.json                 Versionsstaende von PC 1
#
# Nebenbei: bindet das NAS als Netzlaufwerk ein (cmdkey + net use),
# installiert optional Syncthing und Tailscale auf PC 1 und legt
# (Standard, Beschluss laut Dossier) den naechtlichen NAS-Backup-Task
# (Vault + Projekte, mit Erreichbarkeitspruefung) auch auf PC 1 an.
#
# WICHTIG: VOR dem ersten Lauf den 15-Minuten-Sicherheits-Check der
# EX2 Ultra durchfuehren (PLAN.md, Abschnitt 3) und unten
# $Ex2CheckBestaetigt = $true setzen - sonst bricht das Skript ab.
#
# Idempotent: mehrfaches Ausfuehren ist unkritisch. Die Staging-Ordner
# IM PAKET (dot-claude, vault-kopie) werden vor jedem Lauf geleert, damit
# auf PC 1 geloeschte Dateien (Notizen, alte Skills/Settings) nicht im
# Paket liegen bleiben und spaeter auf PC 2 bzw. via Syncthing wieder-
# auferstehen. Lokale Ziele (C:\SecondBrain) werden dagegen nur per /XO
# ergaenzt (nie Altes ueber Neues).
# Als UTF-8 mit BOM speichern. Kompatibel mit Windows PowerShell 5.1.
# Umlaute in Ausgaben bewusst als ae/oe/ue geschrieben.
# Start: powershell -ExecutionPolicy Bypass -File C:\Skripte\export-pc1.ps1
# ============================================================

# ==================== VARIABLEN (EINMAL AUSFUELLEN) ====================
$NasHost             = "192.168.1.20"    # IP oder Name der WD My Cloud EX2 Ultra (z.B. "WDMYCLOUD"); "" = kein NAS
$NasShare            = "daten"           # Name der SMB-Freigabe auf der EX2
$NasUser             = "lichtflut"       # EX2-Benutzerkonto (ECHTER Benutzer, kein Gastzugriff!)
$Ex2CheckBestaetigt  = $false            # ERST auf $true setzen, wenn der 15-Minuten-Sicherheits-Check
                                         # der EX2 Ultra erledigt ist (PLAN.md, Abschnitt 3)!
$Laufwerk            = "N"               # Laufwerksbuchstabe, auf BEIDEN PCs gleich (muss frei sein)
$VaultPfad           = "C:\SecondBrain"  # kanonischer Second-Brain-Pfad (auf BEIDEN PCs gleich; NICHT in OneDrive!)
$VaultQuellPfad      = ""                # wo der Vault HEUTE liegt, z.B. "D:\Notizen\Vault";
                                         # "" = automatisch erkennen (Obsidian-Vault-Liste, sonst $VaultPfad)
$ProjektWurzeln      = @()               # Ordner mit den Git-Repos, z.B. @("D:\", "C:\Projekte");
                                         # @() = automatisch C: UND D: durchsuchen (mind. ein Projekt liegt auf D:\, z.B. D:\zettl-app)
$TransferUnterordner = "pc2-umzug"       # Ordnername auf der NAS-Freigabe fuer das Migrationspaket (NICHT leer lassen!)
$UsbFallbackPfad     = ""                # z.B. "E:\pc2-umzug" - wird genutzt, wenn das NAS nicht erreichbar ist
$SyncthingAufPc1Installieren = $true     # Syncthing auch auf PC 1 installieren (Vault-Sync)
$TailscaleAufPc1Installieren = $true     # Tailscale auch auf PC 1 installieren (beschlossene Architektur;
                                         # Login danach manuell, siehe PLAN.md Restliste)
$SecretsTrotzdemExportieren  = $false    # NUR bewusst auf $true setzen: exportiert die Claude-Konfiguration
                                         # auch dann, wenn der Secret-Scan Treffer meldet. Standard: harter
                                         # Abbruch mit Anleitung (Secrets gehoeren nicht auf NAS/USB).
$BackupAuchAufPc1    = $true             # naechtlichen NAS-Backup-Task (Vault + Projekte) auch auf PC 1 anlegen
                                         # (Beschluss laut Dossier; mit Erreichbarkeitspruefung - unterwegs wird
                                         # der Lauf sauber uebersprungen, Exit 0)
$BackupZielWurzelPc1 = ""                # "" = Standard: \\<NasHost>\<NasShare>\Backup\SecondBrain-PC1
                                         # (eigener Ordner, damit sich PC-1- und PC-2-Staende nicht vermischen)
$AufbewahrungTage    = 30                # so viele datierte Tagesstaende behaelt das PC-1-Backup
$BackupUhrzeit       = "21:00"           # taegliche Backup-Uhrzeit auf PC 1
# =======================================================================

$ErrorActionPreference = "Stop"
$ClaudeDir  = Join-Path $env:USERPROFILE ".claude"
$ClaudeJson = Join-Path $env:USERPROFILE ".claude.json"

# Fruehe Validierung: leerer TransferUnterordner wuerde das Paket in die
# Freigabe-Wurzel legen - und spaetere Loeschbefehle wuerden die KOMPLETTE
# Freigabe treffen. Deshalb harter Abbruch.
if ([string]::IsNullOrWhiteSpace($TransferUnterordner)) {
    throw "TransferUnterordner darf nicht leer sein - bitte im Variablenblock setzen (z.B. 'pc2-umzug')."
}

# Pflichtschritt VOR jeder NAS-Nutzung: 15-Minuten-Sicherheits-Check der
# EX2 Ultra (Portweiterleitungen raus, Cloud Access/DLNA/Indexing aus,
# echter Benutzer, Firmware OS3 vs. OS5, ggf. Passwortwechsel).
# Details: PLAN.md, Abschnitt 3. Ohne Bestaetigung kein NAS-Zugriff.
if ($NasHost -ne "" -and -not $Ex2CheckBestaetigt) {
    throw "EX2-Sicherheits-Check noch nicht bestaetigt. Bitte den 15-Minuten-Check laut PLAN.md (Abschnitt 3) durchfuehren und dann im Variablenblock Ex2CheckBestaetigt = `$true setzen."
}

function Normalisiere([string]$Text) {
    if (-not $Text) { return "" }
    return ($Text.ToLowerInvariant() -replace "[^a-z0-9]", "")
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

Write-Host "=== export-pc1: Start ===" -ForegroundColor Cyan

# ---------------------------------------------------------------
# Schritt 0: NAS als Netzlaufwerk einbinden (idempotent).
# Das Passwort landet NUR im Windows-Anmeldeinformations-Manager,
# nie im Skript und nie in einer Datei. (Es taucht beim Speichern
# einmalig kurz als Prozessargument von cmdkey auf - Details und
# Alternative siehe PLAN.md, Abschnitt 10.)
# ---------------------------------------------------------------
if ($NasHost -ne "") {
    $UncFreigabe = "\\$NasHost\$NasShare"

    # Merker: Wurde der Credential-Manager-Eintrag in DIESEM Lauf angelegt?
    # Nur dann darf er bei einem Verbindungsfehler geloescht werden - ein
    # vorbestehender Eintrag koennte von anderer Software genutzt werden.
    $eintragNeuAngelegt = $false
    $eintragVorhanden = cmdkey /list | Select-String -SimpleMatch $NasHost
    if (-not $eintragVorhanden) {
        $cred = Get-Credential -UserName $NasUser -Message "Passwort des NAS-Benutzers '$NasUser' eingeben"
        if (-not $cred) { throw "Abgebrochen: ohne NAS-Zugangsdaten geht es nicht weiter." }
        $pw = $cred.GetNetworkCredential().Password
        $gespeichert = Speichere-NasZugang $NasHost $cred.UserName $pw
        Remove-Variable pw, cred
        if (-not $gespeichert) {
            throw "NAS-Zugangsdaten nicht gespeichert (Anfuehrungszeichen im Passwort) - Hinweis oben befolgen, dann Skript neu starten."
        }
        $eintragNeuAngelegt = $true
        Write-Host "Zugangsdaten fuer $NasHost im Anmeldeinformations-Manager gespeichert."
    }

    $psLaufwerk = Get-PSDrive -Name $Laufwerk -ErrorAction SilentlyContinue
    if ($psLaufwerk -and $psLaufwerk.DisplayRoot -eq $UncFreigabe) {
        Write-Host "Laufwerk ${Laufwerk}: ist bereits mit $UncFreigabe verbunden."
    } elseif ($psLaufwerk) {
        # NIEMALS eine fremde Zuordnung loeschen - auf einem Produktivsystem
        # koennte sie anderweitig genutzt sein.
        $belegtMit = $psLaufwerk.DisplayRoot
        if (-not $belegtMit) { $belegtMit = "ein lokales Laufwerk" }
        throw "Laufwerk ${Laufwerk}: ist bereits mit '$belegtMit' belegt - bitte in BEIDEN Skripten einen anderen Buchstaben in der Variable Laufwerk waehlen."
    } else {
        # Sicherheitscheck VOR dem Loeschen: In HKCU:\Network gemerkte
        # persistente Zuordnungen sind als PSDrive evtl. nicht sichtbar
        # (getrennter Zustand). Zeigt die gemerkte Zuordnung auf eine ANDERE
        # Freigabe, wird NICHT geloescht, sondern abgebrochen - die Zusage
        # 'nie fremde Zuordnungen loeschen' gilt auch hier.
        $gemerkt = (Get-ItemProperty -Path "HKCU:\Network\$Laufwerk" -ErrorAction SilentlyContinue).RemotePath
        if ($gemerkt -and ($gemerkt -ne $UncFreigabe)) {
            throw "Laufwerk ${Laufwerk}: ist (als gemerkte Zuordnung) bereits mit '$gemerkt' belegt - bitte in BEIDEN Skripten einen anderen Buchstaben in der Variable Laufwerk waehlen."
        }
        # net use schreibt Fehler auf stderr - unter EAP=Stop waere eine
        # stderr-Umleitung in PS 5.1 fatal. Deshalb kurz auf Continue schalten
        # und Exit-Codes selbst pruefen.
        $alteEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        # Gemerkte/tote Zuordnung AUF DIESELBE Freigabe (Systemfehler 85 nach
        # dem Boot) vorab still entfernen - fremde Ziele sind oben ausgeschlossen.
        net use "${Laufwerk}:" /delete /y 2>$null | Out-Null
        net use "${Laufwerk}:" "$UncFreigabe" /persistent:yes 2>&1 | Out-Null
        $netExit = $LASTEXITCODE
        if ($netExit -ne 0) {
            if ($eintragNeuAngelegt) {
                # Haeufigste Ursache: beim ersten Lauf falsch eingetipptes Passwort
                # gespeichert -> Eintrag verwerfen, neu abfragen, EINMAL wiederholen.
                # Geloescht wird NUR der in diesem Lauf angelegte Eintrag.
                Write-Warning "Verbindung fehlgeschlagen - die soeben gespeicherten Zugangsdaten werden verworfen, bitte Passwort erneut eingeben."
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
                # (evtl. von anderer Software genutzt) - er wird NICHT geloescht.
                # Der Fehler kann auch an falscher Freigabe, NAS offline oder
                # einem SMB-Problem liegen.
                Write-Warning "Verbindung fehlgeschlagen. Der gespeicherte NAS-Eintrag stammt NICHT aus diesem Lauf und wird deshalb NICHT geloescht (andere Programme koennten ihn nutzen)."
                Write-Warning "Bitte pruefen: NAS eingeschaltet? Freigabe '$NasShare' korrekt? Erst wenn das gespeicherte Passwort SICHER falsch ist: 'cmdkey /delete:$NasHost' manuell ausfuehren und das Skript neu starten."
            }
        }
        $ErrorActionPreference = $alteEap
        if ($netExit -ne 0) {
            # BEWUSST kein throw: Ein harter Abbruch hier wuerde den
            # dokumentierten USB-Fallback unerreichbar machen. Schritt 1
            # entscheidet per Test-Path selbst zwischen NAS und
            # $UsbFallbackPfad und bricht nur ab, wenn BEIDES fehlt.
            Write-Warning "Laufwerk ${Laufwerk}: konnte nicht mit $UncFreigabe verbunden werden (net use Exit-Code $netExit). Hinweise oben beachten (vorbestehende Zugangsdaten werden nicht automatisch geloescht)."
            Write-Warning "Es geht trotzdem weiter: Ist die Freigabe nicht erreichbar, weicht Schritt 1 auf den USB-Fallback aus (Variable UsbFallbackPfad) oder bricht dort mit klarer Meldung ab."
        } else {
            Write-Host "Laufwerk ${Laufwerk}: verbunden mit $UncFreigabe."
        }
    }

    # Autostart-Reparatur: loest auch nach dem Boot haengende 'getrennte'
    # Zuordnungen (Systemfehler 85) und verbindet still nach. UNC-Pfad
    # gequotet, damit Freigabenamen mit Leerzeichen funktionieren.
    $autostartOrdner = [Environment]::GetFolderPath('Startup')
    $reparaturDatei  = Join-Path $autostartOrdner "NAS-Reconnect.cmd"
    $inhalt = "@echo off`r`n" +
              "if not exist ${Laufwerk}:\ (`r`n" +
              "  net use ${Laufwerk}: /delete /y >nul 2>&1`r`n" +
              "  net use ${Laufwerk}: `"$UncFreigabe`" /persistent:yes`r`n" +
              ")"
    Set-Content -Path $reparaturDatei -Value $inhalt -Encoding Ascii
}

# ---------------------------------------------------------------
# Schritt 1: Zielordner fuer das Migrationspaket bestimmen.
# Standard: NAS (UNC-Pfad). Fallback: USB-Stick.
# ---------------------------------------------------------------
$TransferPfad = $null
if ($NasHost -ne "" -and (Test-Path "\\$NasHost\$NasShare")) {
    $TransferPfad = "\\$NasHost\$NasShare\$TransferUnterordner"
}
if (-not $TransferPfad -and $UsbFallbackPfad -ne "") {
    $TransferPfad = $UsbFallbackPfad
    Write-Warning "NAS nicht erreichbar oder nicht konfiguriert - verwende USB-Fallback: $UsbFallbackPfad"
}
if (-not $TransferPfad) {
    throw "Kein Ziel fuer das Migrationspaket: NAS nicht erreichbar und kein UsbFallbackPfad gesetzt."
}
New-Item -ItemType Directory -Force -Path $TransferPfad | Out-Null
Write-Host "Migrationspaket wird abgelegt unter: $TransferPfad"

# ---------------------------------------------------------------
# Schritt 2: Programmliste exportieren (winget + Registry-Sicherheitsnetz)
# ---------------------------------------------------------------
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "winget wurde nicht gefunden. Bitte 'App-Installer' ueber den Microsoft Store aktualisieren."
}

$AppsJson      = Join-Path $TransferPfad "apps.json"
$WarnDatei     = Join-Path $TransferPfad "export-warnungen.txt"
$KomplettDatei = Join-Path $TransferPfad "programme-komplett.txt"
$RestDatei     = Join-Path $TransferPfad "nicht-automatisch.txt"

Write-Host "winget-Export laeuft ..."
# 2>&1 unter EAP=Stop ist in PS 5.1 heikel -> kurz auf Continue schalten
$alteEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$exportAusgabe = winget export -o $AppsJson --accept-source-agreements 2>&1
$ErrorActionPreference = $alteEap
$exportAusgabe | Out-File -FilePath $WarnDatei -Encoding UTF8
if (-not (Test-Path -LiteralPath $AppsJson)) {
    throw "winget export hat keine apps.json erzeugt. Details: $WarnDatei"
}

# Vollstaendige Programmliste aus der Registry (64-bit, 32-bit, Benutzerkontext)
$UninstallPfade = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
)
$Programme = Get-ItemProperty -Path $UninstallPfade -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -and ($_.SystemComponent -ne 1) } |
    Select-Object DisplayName, DisplayVersion, Publisher |
    Sort-Object DisplayName -Unique
$Programme | ForEach-Object {
    "{0} | Version: {1} | Hersteller: {2}" -f $_.DisplayName, $_.DisplayVersion, $_.Publisher
} | Out-File -FilePath $KomplettDatei -Encoding UTF8

# Abgleich: was steckt vermutlich NICHT in apps.json?
# Namens-Heuristik, bewusst grosszuegig - lieber ein Eintrag zu viel auf
# der manuellen Liste als ein vergessenes Programm.
$Export = Get-Content -LiteralPath $AppsJson -Raw | ConvertFrom-Json
$IdNamen = @()
foreach ($Quelle in $Export.Sources) {
    foreach ($Paket in $Quelle.Packages) {
        $IdNamen += Normalisiere (($Paket.PackageIdentifier -split "\.")[-1])
    }
}
$NichtAutomatisch = foreach ($P in $Programme) {
    $Name = Normalisiere $P.DisplayName
    $Gefunden = $false
    if ($Name.Length -ge 4) {
        foreach ($IdName in $IdNamen) {
            if ($IdName.Length -ge 4 -and (($Name -like "*$IdName*") -or ($IdName -like "*$Name*"))) {
                $Gefunden = $true; break
            }
        }
    }
    if (-not $Gefunden) { $P }
}
@("# Programme, die winget vermutlich NICHT automatisch installiert.",
  "# Auf PC 2 manuell pruefen (Treiber/Runtimes duerfen ignoriert werden).",
  "") + ($NichtAutomatisch | ForEach-Object {
    "{0} | Version: {1} | Hersteller: {2}" -f $_.DisplayName, $_.DisplayVersion, $_.Publisher
}) | Out-File -FilePath $RestDatei -Encoding UTF8

# OEM-/Laptop-Hinweisliste: winget export erfasst auch hardware-spezifische
# Pakete des MSI-Titan-Laptops (MSI Center, Nahimic, Killer-Netzwerktools,
# NVIDIA-Utilities ...), die auf der Threadripper-Workstation nutzlos bis
# stoerend waeren. Hier NICHT automatisch loeschen (konservativ), sondern
# Verdachtsliste schreiben - vor dem Import auf PC 2 die betroffenen
# Eintraege aus apps.json entfernen (PLAN.md, Block 2).
$OemMuster = @('MSI.*', '*MicroStar*', '*Micro-Star*', '*Nahimic*', '*Killer*',
               'Nvidia.*', '*GeForce*', '*SteelSeries*', '*DragonCenter*')
$OemTreffer = @()
foreach ($Quelle in $Export.Sources) {
    foreach ($Paket in $Quelle.Packages) {
        foreach ($Muster in $OemMuster) {
            if ($Paket.PackageIdentifier -like $Muster) { $OemTreffer += $Paket.PackageIdentifier; break }
        }
    }
}
$OemDatei = Join-Path $TransferPfad "oem-hinweise.txt"
$OemZeilen = @("# Vermutlich laptop-/OEM-spezifische Pakete in apps.json (Verdachtsliste, kann Fehltreffer enthalten).",
               "# Diese Eintraege VOR dem Import auf PC 2 aus apps.json loeschen - PC 2 ist eine andere Hardware.",
               "# GPU-Treiber kommen ohnehin manuell (PLAN.md, Restliste Punkt 14).",
               "")
if ($OemTreffer.Count -gt 0) {
    $OemZeilen += ($OemTreffer | Sort-Object -Unique)
    Write-Warning ("apps.json enthaelt {0} vermutlich laptop-/OEM-spezifische(s) Paket(e) - Liste: oem-hinweise.txt. Vor dem Import auf PC 2 aus apps.json loeschen (PLAN.md, Block 2)." -f (@($OemTreffer | Sort-Object -Unique)).Count)
} else {
    $OemZeilen += "(keine bekannten OEM-Muster gefunden - apps.json trotzdem einmal kurz durchsehen)"
}
$OemZeilen | Out-File -FilePath $OemDatei -Encoding UTF8
Write-Host "Programmliste exportiert (apps.json, programme-komplett.txt, nicht-automatisch.txt, oem-hinweise.txt)."

# ---------------------------------------------------------------
# Schritt 3: Claude-Code-Konfiguration exportieren - OHNE Secrets.
# Ausgeschlossen: .credentials.json (OAuth-Tokens!), history.jsonl,
# sowie reiner Maschinen-/Sitzungszustand (Transkripte, Caches, ...).
# ---------------------------------------------------------------
if (Test-Path $ClaudeDir) {
    $zielDotClaude = Join-Path $TransferPfad "dot-claude"
    # Staging-Ordner vor dem Kopieren LEEREN: robocopy /E ist nur additiv -
    # auf PC 1 zwischen zwei Export-Laeufen geloeschte Dateien (alte Skills,
    # Agents, Settings) blieben sonst im Paket liegen und wuerden von
    # setup-pc2.ps1 auf PC 2 wieder eingespielt (stille Wiederauferstehung).
    # Gefahrlos: der Pfad liegt garantiert unter dem oben geprueften,
    # nicht-leeren $TransferUnterordner - nie in der Freigabe-Wurzel.
    if (Test-Path $zielDotClaude) { Remove-Item $zielDotClaude -Recurse -Force }
    robocopy $ClaudeDir $zielDotClaude /E /R:1 /W:1 /XF .credentials.json history.jsonl /XD projects shell-snapshots statsig todos backups cache file-history downloads debug ide logs | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy-Fehler beim Export von .claude (Code $LASTEXITCODE)" }

    # Auto-Memory je Projekt gezielt mitnehmen (nur memory\, keine Transkripte)
    $projDir = Join-Path $ClaudeDir "projects"
    if (Test-Path $projDir) {
        Get-ChildItem $projDir -Directory | ForEach-Object {
            $mem = Join-Path $_.FullName "memory"
            if (Test-Path $mem) {
                $ziel = Join-Path $zielDotClaude ("projects\" + $_.Name + "\memory")
                robocopy $mem $ziel /E /R:1 /W:1 | Out-Null
            }
        }
    }
    Write-Host "Claude-Konfiguration exportiert (ohne Credentials/Transkripte)."

    # Sicherheits-Scan: Die kopierten Dateien koennen Secrets enthalten
    # (env-Bloecke mit API-Keys, apiKeyHelper-Skripte, Hooks mit Tokens).
    # Gescannt werden ALLE Textdateien im Paket - nicht nur JSON, sondern
    # auch CLAUDE.md, Skills/Agents (Markdown) und Hook-/Helper-Skripte
    # (.ps1/.cmd/.sh), denn genau dort landen hartcodierte Keys gern.
    # Die Muster sind WERTETRAGEND: blosse Namen wie maxTokens oder
    # MAX_THINKING_TOKENS ohne dranhaengenden Wert loesen KEINEN Abbruch
    # aus (frueher brachen harmlose Settings den Export faelschlich ab).
    # Das Dossier verlangt 'Secrets AUSFILTERN', nicht nur melden -
    # deshalb bei Treffern HARTER ABBRUCH: das bereits kopierte
    # dot-claude-Paket wird wieder geloescht, damit keine Secrets auf
    # NAS/USB liegen bleiben. Bewusster Override:
    # $SecretsTrotzdemExportieren = $true im Variablenblock.
    $secretMuster = @(
        'sk-ant-[A-Za-z0-9_\-]{8,}',                                        # Anthropic-Key MIT Wert
        '"[A-Za-z0-9_\-]*(API_KEY|API-KEY|TOKEN)[A-Za-z0-9_\-]*"\s*:\s*"[^"]{8,}', # Schluessel MIT nichttrivialem Wert
        'apiKeyHelper',                                                     # eigene Key-Beschaffung konfiguriert
        'ghp_[A-Za-z0-9]{20,}',                                             # GitHub-PAT (klassisch)
        'github_pat_[A-Za-z0-9_]{20,}',                                     # GitHub-PAT (fine-grained)
        'glpat-[A-Za-z0-9_\-]{10,}'                                         # GitLab-PAT
    )
    # Bekannte harmlose Token-ZAEHL-Schluessel herausfiltern (z.B.
    # MAX_THINKING_TOKENS, CLAUDE_CODE_MAX_OUTPUT_TOKENS, maxTokens) -
    # das sind Mengenangaben, keine Secrets.
    $harmloseMuster = '(THINKING_TOKENS|OUTPUT_TOKENS|INPUT_TOKENS|MAX_TOKENS|maxTokens|max_tokens|num_tokens)'
    $scanDateien = Get-ChildItem -Path $zielDotClaude -Recurse -Include *.json,*.md,*.ps1,*.cmd,*.bat,*.sh,*.txt,*.yaml,*.yml -File -ErrorAction SilentlyContinue
    $scanTreffer = @()
    if ($scanDateien) {
        $scanTreffer = @($scanDateien | Select-String -Pattern $secretMuster -ErrorAction SilentlyContinue |
            Where-Object { $_.Line -notmatch $harmloseMuster })
    }
    if ($scanTreffer.Count -gt 0) {
        $trefferDateien = @($scanTreffer | Select-Object -ExpandProperty Path -Unique)
        if ($SecretsTrotzdemExportieren) {
            Write-Warning "SecretsTrotzdemExportieren = `$true: Das dot-claude-Paket enthaelt vermutlich Secrets und wird TROTZDEM exportiert - Migrationspaket nach dem Setup auf PC 2 UNBEDINGT loeschen!"
            foreach ($t in $trefferDateien) { Write-Warning ("  Betroffene Datei: " + $t) }
        } else {
            Write-Warning "Secret-Scan hat Treffer gefunden - der Export der Claude-Konfiguration wird ABGEBROCHEN, damit keine Secrets auf NAS/USB landen. Betroffen (Pfad auf PC 1):"
            foreach ($t in $trefferDateien) {
                Write-Warning ("  " + $t.Replace($zielDotClaude, $ClaudeDir))
            }
            # Bereits kopierte Dateien wieder aus dem Paket entfernen
            Remove-Item $zielDotClaude -Recurse -Force -ErrorAction SilentlyContinue
            throw ("Secrets in der Claude-Konfiguration gefunden - dot-claude wurde wieder aus dem Migrationspaket entfernt. " +
                   "Bitte die betroffenen Eintraege (z.B. env-Bloecke mit API-Keys, apiKeyHelper, TOKEN-Werte) in den oben genannten Dateien auf PC 1 entfernen und den Export wiederholen. " +
                   "Nur wenn die Treffer nachweislich harmlos sind (z.B. blosse Variablen-NAMEN ohne Werte): SecretsTrotzdemExportieren = `$true im Variablenblock setzen.")
        }
    }
} else {
    Write-Warning "Kein $ClaudeDir gefunden - Claude Code scheint auf PC 1 nicht eingerichtet zu sein."
}

# Globale MCP-Server: NUR der Schluessel 'mcpServers' aus .claude.json.
# Die Datei als Ganzes wird bewusst NICHT kopiert (Session-/Kontozustand,
# maschinenspezifische Projekt-Trust-Eintraege).
if (Test-Path $ClaudeJson) {
    $cfg = Get-Content $ClaudeJson -Raw | ConvertFrom-Json
    if ($cfg.PSObject.Properties.Name -contains "mcpServers" -and $cfg.mcpServers) {
        $mcpDatei = Join-Path $TransferPfad "mcp-servers.json"
        [System.IO.File]::WriteAllText($mcpDatei, ($cfg.mcpServers | ConvertTo-Json -Depth 30), (New-Object System.Text.UTF8Encoding($false)))
        Write-Host "MCP-Server exportiert: mcp-servers.json"
        Write-Warning "mcp-servers.json kann API-Keys in env-Bloecken enthalten - setup-pc2.ps1 loescht die Datei nach dem Merge automatisch."
    }
}

# ---------------------------------------------------------------
# Schritt 4: Git-Konfiguration + Repo-Liste + Projekt-Konfig-Fundliste
# ---------------------------------------------------------------
$gitconfig = Join-Path $env:USERPROFILE ".gitconfig"
# Token-Muster fuer den Sicherheits-Scan: URL-Credentials (https://user:TOKEN@...)
# sowie gaengige PAT-Prefixe von GitHub/GitLab.
$tokenMuster = @('://[^/@\s]+:[^@/\s]+@', 'ghp_', 'github_pat_', 'glpat-')
if (Test-Path $gitconfig) {
    $gitconfigZiel = Join-Path $TransferPfad "gitconfig.txt"
    # NICHT 1:1 kopieren: die .gitconfig kann eingebettete Tokens enthalten
    # (insteadOf-Regeln oder URLs der Form https://user:TOKEN@github.com/...)
    # und landet unverschluesselt auf NAS/USB. Deshalb dieselbe Maskierung
    # wie bei repo-liste.txt anwenden - der Git Credential Manager stellt
    # die Authentifizierung auf PC 2 ohnehin per Browser-Login neu her,
    # die Tokens werden dort nicht gebraucht.
    $gitconfigInhalt = Get-Content $gitconfig -Raw
    $gitconfigOriginal = $gitconfigInhalt
    $gitconfigInhalt = $gitconfigInhalt -replace '://[^/@\s]+:[^@/\s]+@', '://***@'
    $gitconfigInhalt = $gitconfigInhalt -replace 'github_pat_[A-Za-z0-9_]+', '***PAT-MASKIERT***'
    $gitconfigInhalt = $gitconfigInhalt -replace 'ghp_[A-Za-z0-9]+', '***PAT-MASKIERT***'
    $gitconfigInhalt = $gitconfigInhalt -replace 'glpat-[A-Za-z0-9_\-]+', '***PAT-MASKIERT***'
    # Ohne BOM schreiben (git liest die Datei spaeter als ~/.gitconfig)
    [System.IO.File]::WriteAllText($gitconfigZiel, $gitconfigInhalt, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ".gitconfig exportiert (eingebettete Zugangsdaten/Tokens maskiert)."
    # Sicherheitsnetz zusaetzlich zur Maskierung: Rest-Treffer melden
    # (unbekannte Token-Formate koennen der Maskierung entgehen).
    $gitTreffer = @(Select-String -Path $gitconfigZiel -Pattern $tokenMuster -ErrorAction SilentlyContinue)
    if ($gitTreffer.Count -gt 0) {
        Write-Warning "gitconfig.txt enthaelt trotz Maskierung noch verdaechtige Muster (unbekanntes Token-Format?)!"
        Write-Warning "Empfehlung: Token aus der .gitconfig auf PC 1 entfernen (der Git Credential Manager uebernimmt das sicher) und den Export wiederholen. Migrationspaket nach dem Setup UNBEDINGT loeschen."
    }
    if ($gitconfigInhalt -ne $gitconfigOriginal) {
        Write-Warning "Hinweis: In gitconfig.txt wurden Zugangsdaten maskiert (***). Auf PC 2 funktionieren betroffene insteadOf-/URL-Eintraege nicht mehr - gewollt: GitHub laeuft dort ueber HTTPS + Git Credential Manager (Browser-Login)."
    }
}
# Git-Repos suchen: entweder in den angegebenen $ProjektWurzeln oder
# automatisch auf C: UND D: (mindestens ein Projekt liegt auf D:\,
# z.B. D:\zettl-app - deshalb NIE nur ein Laufwerk annehmen).
# BFS mit Ausschlussliste statt Get-ChildItem -Recurse: System-, AppData-
# und OneDrive-Ordner werden gar nicht erst betreten (OneDrive wuerde
# sonst Cloud-Platzhalter herunterladen). In einem gefundenen Repo wird
# nicht weiter abgestiegen.
function Finde-GitRepos([string[]]$Wurzeln, [int]$MaxTiefe) {
    $ausschluss = @('Windows', 'Program Files', 'Program Files (x86)', 'ProgramData',
                    'PerfLogs', '$Recycle.Bin', 'System Volume Information', 'Recovery',
                    'AppData', 'node_modules', '.git', 'OneDrive*', '.stversions')
    $gefunden = New-Object System.Collections.ArrayList
    $warteschlange = New-Object System.Collections.Queue
    foreach ($w in $Wurzeln) {
        if (Test-Path $w) { $warteschlange.Enqueue(@{ Pfad = (Get-Item $w).FullName; Tiefe = 0 }) }
    }
    while ($warteschlange.Count -gt 0) {
        $eintrag = $warteschlange.Dequeue()
        if (Test-Path (Join-Path $eintrag.Pfad ".git")) {
            [void]$gefunden.Add($eintrag.Pfad)
            continue
        }
        if ($eintrag.Tiefe -ge $MaxTiefe) { continue }
        $unterordner = Get-ChildItem -Path $eintrag.Pfad -Directory -ErrorAction SilentlyContinue
        foreach ($u in $unterordner) {
            $ueberspringen = $false
            foreach ($a in $ausschluss) {
                if ($u.Name -like $a) { $ueberspringen = $true; break }
            }
            if (-not $ueberspringen) {
                $warteschlange.Enqueue(@{ Pfad = $u.FullName; Tiefe = ($eintrag.Tiefe + 1) })
            }
        }
    }
    return $gefunden
}

$sucheWurzeln = @($ProjektWurzeln | Where-Object { $_ -and (Test-Path $_) })
if ($sucheWurzeln.Count -eq 0) {
    # Automatik: alle festen Laufwerke C: und D: (weitere feste Laufwerke
    # bei Bedarf in $ProjektWurzeln eintragen)
    foreach ($lw in @("C:\", "D:\")) {
        if (Test-Path $lw) { $sucheWurzeln += $lw }
    }
    Write-Host "Keine ProjektWurzeln angegeben - suche Git-Repos automatisch auf: $($sucheWurzeln -join ', ') (Tiefe 3)"
}
$repoPfade = @(Finde-GitRepos -Wurzeln $sucheWurzeln -MaxTiefe 3)
$repoZeilen = @("# Git-Repos auf PC 1 (Pfad | Remote 'origin') - auf PC 2 bei Bedarf neu klonen",
                ("# Durchsucht wurden: " + ($sucheWurzeln -join ', ')), "")
$gitDa = [bool](Get-Command git -ErrorAction SilentlyContinue)
foreach ($repoPfad in $repoPfade) {
    $remote = ""
    if ($gitDa) {
        # 'git config --get remote.origin.url' schreibt bei fehlendem
        # origin nichts auf stderr (nur Exit-Code 1). Trotzdem EAP
        # absichern: stderr-Umleitung unter EAP=Stop ist in PS 5.1 fatal.
        $alteEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $remote = (& git -C $repoPfad config --get remote.origin.url 2>$null | Out-String).Trim()
        $ErrorActionPreference = $alteEap
        # Sicherheits-Maskierung: eingebettete Zugangsdaten in Remote-URLs
        # (https://user:TOKEN@host/...) NICHT ins Paket schreiben - fuer
        # das Neu-Klonen auf PC 2 reicht die bereinigte URL.
        $remote = $remote -replace '://[^/@]+:[^@/]+@', '://***@'
    }
    $repoZeilen += ("{0} | {1}" -f $repoPfad, $remote)
}
$repoListeDatei = Join-Path $TransferPfad "repo-liste.txt"
$repoZeilen | Out-File -FilePath $repoListeDatei -Encoding UTF8
# Sicherheitsnetz zusaetzlich zur Maskierung: auch die fertige Liste scannen
$repoTreffer = @(Select-String -Path $repoListeDatei -Pattern $tokenMuster -ErrorAction SilentlyContinue)
if ($repoTreffer.Count -gt 0) {
    Write-Warning "repo-liste.txt enthaelt vermutlich Tokens/Zugangsdaten - bitte pruefen und Migrationspaket nach dem Setup UNBEDINGT loeschen!"
}

# Fundliste projektbezogener Claude-Konfiguration (nur zur Kontrolle -
# die Projekte selbst wandern per Git-Clone bzw. Datenumzug)
$fundliste = @()
foreach ($repoPfad in $repoPfade) {
    $fundliste += Get-ChildItem $repoPfad -Recurse -Depth 2 -Include "CLAUDE.md",".mcp.json" -File -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
}
$fundliste | Out-File -FilePath (Join-Path $TransferPfad "projekt-konfig-fundliste.txt") -Encoding UTF8
Write-Host ("Repo-Liste ({0} Repo(s)) und Projekt-Konfig-Fundliste erstellt." -f $repoPfade.Count)

# graphify-CLI erfassen: wird in zettl per CLAUDE.md-Regeln + Commit-Hook
# verwendet und muss auf PC 2 nachgezogen werden. Hier nur DOKUMENTIEREN,
# wie es auf PC 1 installiert ist (Pfad + npm-Globalpakete) - die
# Installation auf PC 2 steht in der manuellen Restliste (PLAN.md).
$alteEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$graphifyPfad = (& where.exe graphify 2>$null | Out-String).Trim()
$npmGlobal = ""
if (Get-Command npm -ErrorAction SilentlyContinue) {
    $npmGlobal = (& npm list -g --depth=0 2>$null | Out-String).Trim()
}
$ErrorActionPreference = $alteEap
$graphifyZeilen = @("# graphify auf PC 1 - Grundlage fuer die Nachinstallation auf PC 2 (PLAN.md, Restliste)", "")
if ($graphifyPfad) {
    $graphifyZeilen += "where.exe graphify:"
    $graphifyZeilen += $graphifyPfad
} else {
    $graphifyZeilen += "where.exe graphify: NICHT im PATH gefunden."
}
$graphifyZeilen += ""
$graphifyZeilen += "npm list -g --depth=0:"
if ($npmGlobal) { $graphifyZeilen += $npmGlobal } else { $graphifyZeilen += "(npm nicht gefunden oder keine Ausgabe)" }
$graphifyZeilen | Out-File -FilePath (Join-Path $TransferPfad "graphify-info.txt") -Encoding UTF8
Write-Host "graphify-Installationsweg dokumentiert (graphify-info.txt)."

# ---------------------------------------------------------------
# Schritt 5: Second Brain (Vault)
# 5a) Vault-Quelle bestimmen: falls $VaultQuellPfad leer ist, die auf
#     PC 1 registrierten Obsidian-Vaults automatisch erkennen
#     (%APPDATA%\obsidian\obsidian.json, Format: vaults.<id>.path/ts/open)
#     und die Wahl protokollieren (vault-auswahl.txt im Paket).
# 5b) Vault auf PC 1 einmalig auf den kanonischen Pfad bringen,
#     damit Syncthing auf beiden PCs denselben Pfad nutzt.
# 5c) Kopie als Startstand fuer PC 2 ins Migrationspaket legen.
# ---------------------------------------------------------------
# Der Vault gehoert NICHT in einen OneDrive-Ordner: OneDrive bleibt
# unangetastet der Sync-Layer fuer '01_Buero'; der Vault laeuft separat
# ueber Syncthing (zwei Sync-Dienste auf demselben Ordner = Konflikte).
if ($VaultPfad -like "*OneDrive*") {
    throw "VaultPfad '$VaultPfad' liegt in einem OneDrive-Ordner - bitte einen lokalen Pfad ausserhalb von OneDrive waehlen (Standard: C:\SecondBrain)."
}
$vaultAuswahlZeilen = @("# Protokoll der Obsidian-Vault-Erkennung auf PC 1", "")
# Merker: Wurde VaultQuellPfad im Variablenblock MANUELL gesetzt? (Wichtig
# fuer die Warnung unten, wenn das Ziel bereits befuellt ist.)
$vaultQuellManuell = ($VaultQuellPfad -ne "")
$zielHatDateien = $false
if (Test-Path $VaultPfad) {
    $zielHatDateien = ((Get-ChildItem -Path $VaultPfad -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne ".stignore" } | Measure-Object).Count -gt 0)
}
# Die Erkennung laeuft BEWUSST auch dann, wenn $VaultPfad schon Dateien
# enthaelt: Die Quelle wird fuer den /XO-Nachlauf unten gebraucht, der eine
# Teilkopie (z.B. frueherer Abbruch, weil Obsidian noch offen war)
# vervollstaendigt, statt sie still ins Paket wandern zu lassen.
if ($VaultQuellPfad -eq "") {
    $obsidianJson = Join-Path $env:APPDATA "obsidian\obsidian.json"
    if (Test-Path $obsidianJson) {
        try {
            $obsCfg = Get-Content $obsidianJson -Raw | ConvertFrom-Json
            $vaultEintraege = @()
            if ($obsCfg.PSObject.Properties.Name -contains "vaults") {
                foreach ($v in $obsCfg.vaults.PSObject.Properties) {
                    $vp = $v.Value.path
                    if ($vp -and (Test-Path $vp) -and ($vp -ne $VaultPfad)) {
                        $offen = $false
                        if ($v.Value.PSObject.Properties.Name -contains "open") { $offen = [bool]$v.Value.open }
                        $ts = 0
                        if ($v.Value.PSObject.Properties.Name -contains "ts") { $ts = [long]$v.Value.ts }
                        $vaultEintraege += New-Object PSObject -Property @{ Pfad = $vp; Offen = $offen; Ts = $ts }
                        $vaultAuswahlZeilen += ("Gefunden: {0} (zuletzt genutzt: ts={1}, offen={2})" -f $vp, $ts, $offen)
                    }
                }
            }
            if ($vaultEintraege.Count -gt 0) {
                # Wahl: der aktuell geoeffnete Vault, sonst der zuletzt genutzte (hoechstes ts)
                $wahl = $vaultEintraege | Where-Object { $_.Offen } | Select-Object -First 1
                if (-not $wahl) { $wahl = $vaultEintraege | Sort-Object Ts -Descending | Select-Object -First 1 }
                $VaultQuellPfad = $wahl.Pfad
                $vaultAuswahlZeilen += ""
                $vaultAuswahlZeilen += ("GEWAEHLT: " + $VaultQuellPfad + " (geoeffneter bzw. zuletzt genutzter Vault)")
                Write-Host "Obsidian-Vault automatisch erkannt: $VaultQuellPfad (Protokoll: vault-auswahl.txt im Paket - bitte kurz pruefen!)"
                if ($vaultEintraege.Count -gt 1) {
                    Write-Warning ("Es wurden {0} Obsidian-Vaults gefunden - falls der gewaehlte nicht der richtige ist: VaultQuellPfad im Variablenblock setzen und Skript neu starten." -f $vaultEintraege.Count)
                }
                if ($VaultQuellPfad -like "*OneDrive*") {
                    Write-Warning "Der erkannte Vault liegt aktuell in einem OneDrive-Ordner - er wird nach $VaultPfad verschoben (gut so: Vault-Sync uebernimmt kuenftig Syncthing, nicht OneDrive)."
                }
            } else {
                $vaultAuswahlZeilen += "Keine nutzbaren Vault-Eintraege in obsidian.json gefunden."
            }
        } catch {
            $vaultAuswahlZeilen += ("obsidian.json konnte nicht gelesen werden: " + $_.Exception.Message)
        }
    } else {
        $vaultAuswahlZeilen += "Keine obsidian.json unter %APPDATA%\obsidian gefunden (Obsidian nicht installiert oder nie gestartet)."
    }
} else {
    $vaultAuswahlZeilen += ("Keine Erkennung noetig: VaultQuellPfad ist manuell gesetzt auf '" + $VaultQuellPfad + "'.")
}
$vaultAuswahlZeilen | Out-File -FilePath (Join-Path $TransferPfad "vault-auswahl.txt") -Encoding UTF8

# Obsidian soll waehrend der Vault-Uebernahme GESCHLOSSEN sein (PLAN.md,
# Block 1, Schritt 3): Laeuft es noch, kann robocopy an gesperrten Dateien
# scheitern (Teilkopie!) und die Umbenennung des alten Ordners fehlschlagen.
if (Get-Process -Name "Obsidian" -ErrorAction SilentlyContinue) {
    Write-Warning "Obsidian laeuft noch! Bitte Obsidian jetzt schliessen (PLAN.md, Block 1, Schritt 3) - sonst kann die Vault-Uebernahme scheitern oder unvollstaendig bleiben."
}
if ($VaultQuellPfad -ne "" -and (Test-Path $VaultQuellPfad) -and ($VaultQuellPfad -ne $VaultPfad)) {
    # Wiederholungsschutz: NICHT auf '.obsidian' pruefen (das Second Brain
    # muss kein Obsidian-Vault sein), sondern darauf, ob das Ziel schon
    # Dateien enthaelt. Sonst wuerde jeder erneute Lauf einen alten Stand
    # ueber zwischenzeitliche Aenderungen kopieren. Eine einzelne .stignore
    # zaehlt dabei NICHT als 'befuellt' (gleiche Rerun-Logik wie in
    # setup-pc2.ps1: sonst wuerde ein frueherer Fehllauf den Import blockieren).
    $zielBelegt = $false
    if (Test-Path $VaultPfad) {
        $zielBelegt = ((Get-ChildItem -Path $VaultPfad -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne ".stignore" } | Measure-Object).Count -gt 0)
    }
    if ($zielBelegt) {
        if ($vaultQuellManuell) {
            Write-Host "Vault-Uebernahme uebersprungen: $VaultPfad enthaelt bereits Dateien (Uebernahme war offenbar schon erfolgt)."
            # Der eigentliche Fehlerfall aus PLAN.md, Abschnitt 9, Punkt 10:
            # Die Automatik hatte den FALSCHEN Vault gewaehlt, der Nutzer setzt
            # nun VaultQuellPfad - aber das Ziel ist schon (falsch) befuellt.
            # Ohne Aufraeumen wuerde der falsche Inhalt von $VaultPfad weiter
            # ins Paket und in den Syncthing-Sync wandern. Deshalb hier KEIN
            # /XO-Nachlauf (der wuerde richtigen und falschen Inhalt mischen),
            # sondern deutliche Reparaturanleitung.
            Write-Warning "ACHTUNG: VaultQuellPfad ist MANUELL gesetzt ('$VaultQuellPfad'), aber $VaultPfad ist bereits befuellt - der VORHANDENE Inhalt von $VaultPfad hat Vorrang und wandert ins Migrationspaket!"
            Write-Warning "Falls $VaultPfad den FALSCHEN Stand enthaelt (die Automatik hatte den falschen Vault gewaehlt), so reparieren (Details: PLAN.md, Abschnitt 9, Punkt 10):"
            Write-Warning "  1. Obsidian schliessen."
            Write-Warning "  2. Den falsch befuellten Ordner $VaultPfad komplett loeschen oder umbenennen."
            Write-Warning "  3. Den faelschlich umbenannten Ordner '<Name>-ALT-nicht-mehr-verwenden' wieder auf den Originalnamen zurueckbenennen."
            Write-Warning "  4. Dieses Skript erneut ausfuehren (VaultQuellPfad bleibt gesetzt) - erst dann mit PC 2 weitermachen."
        } else {
            # /XO-Nachlauf statt Komplett-Skip: Ein frueherer Lauf kann mitten
            # in der Uebernahme abgebrochen sein (z.B. robocopy-Fehler, weil
            # Obsidian noch offen war) - das Ziel gilt dann als 'befuellt',
            # ist aber nur eine TEILKOPIE, die sonst still ins Paket und in
            # den Syncthing-Sync wandern wuerde. /XO kopiert nie Aelteres
            # ueber Neueres, vervollstaendigt aber genau so eine Teilkopie.
            robocopy $VaultQuellPfad $VaultPfad /E /XO /R:1 /W:2 /NP | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy-Fehler beim /XO-Nachlauf der Vault-Uebernahme (Code $LASTEXITCODE) - ist Obsidian wirklich geschlossen?" }
            Write-Host "Vault-Ziel $VaultPfad war bereits befuellt - /XO-Nachlauf aus '$VaultQuellPfad' hat eine etwaige Teilkopie vervollstaendigt (nichts Neueres ueberschrieben)."
            # Alten Ordner markieren, falls das beim ersten Lauf nicht klappte
            # (z.B. weil Obsidian ihn noch gesperrt hatte).
            try {
                $altName = (Split-Path $VaultQuellPfad -Leaf) + "-ALT-nicht-mehr-verwenden"
                Rename-Item -Path $VaultQuellPfad -NewName $altName -ErrorAction Stop
                Write-Host "Alter Vault-Ordner umbenannt in '$altName'. Obsidian/Editor kuenftig NUR noch mit $VaultPfad oeffnen (siehe PLAN.md, Block 1, Schritt 8)."
            } catch {
                Write-Warning ("Alter Vault-Ordner konnte nicht umbenannt werden (evtl. noch in Obsidian geoeffnet): " + $_.Exception.Message)
                Write-Warning "WICHTIG: Ab jetzt NUR noch unter $VaultPfad arbeiten - den alten Ordner '$VaultQuellPfad' manuell in '...-ALT-nicht-mehr-verwenden' umbenennen!"
            }
        }
    } else {
        New-Item -ItemType Directory -Force -Path $VaultPfad | Out-Null
        # /XO: niemals aeltere Quelldateien ueber neuere Zieldateien kopieren
        robocopy $VaultQuellPfad $VaultPfad /E /XO /R:1 /W:2 /NP | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy-Fehler bei der Vault-Uebernahme (Code $LASTEXITCODE)" }
        Write-Host "Vault nach $VaultPfad uebernommen."
        # Alten Ordner deutlich markieren, damit niemand versehentlich dort
        # weiterschreibt (stille Datendivergenz waere die Folge).
        try {
            $altName = (Split-Path $VaultQuellPfad -Leaf) + "-ALT-nicht-mehr-verwenden"
            Rename-Item -Path $VaultQuellPfad -NewName $altName -ErrorAction Stop
            Write-Host "Alter Vault-Ordner umbenannt in '$altName'. Obsidian/Editor kuenftig NUR noch mit $VaultPfad oeffnen (siehe PLAN.md, Block 1, Schritt 8)."
        } catch {
            Write-Warning ("Alter Vault-Ordner konnte nicht umbenannt werden (evtl. noch in Obsidian geoeffnet): " + $_.Exception.Message)
            Write-Warning "WICHTIG: Ab jetzt NUR noch unter $VaultPfad arbeiten - den alten Ordner '$VaultQuellPfad' manuell in '...-ALT-nicht-mehr-verwenden' umbenennen!"
        }
    }
}
$vaultQuelle = $VaultPfad
if (-not (Test-Path $vaultQuelle) -and $VaultQuellPfad -ne "") { $vaultQuelle = $VaultQuellPfad }
$vaultExportOk = $false
$vaultMarker   = Join-Path $TransferPfad "VAULT-FEHLT.txt"
if (Test-Path $vaultQuelle) {
    # Geraetespezifische Obsidian-Dateien vom kuenftigen Sync ausnehmen
    $stignore = Join-Path $vaultQuelle ".stignore"
    if (-not (Test-Path $stignore)) {
        @("// Geraetespezifische Obsidian-Dateien nicht synchronisieren",
          ".obsidian/workspace.json",
          ".obsidian/workspace-mobile.json",
          ".trash") | Set-Content -Path $stignore -Encoding UTF8
    }
    $vaultZiel = Join-Path $TransferPfad "vault-kopie"
    # Staging-Ordner vor dem Kopieren LEEREN (wie bei dot-claude oben):
    # sonst blieben auf PC 1 geloeschte Notizen im Paket liegen, wuerden auf
    # PC 2 wieder eingespielt und von Syncthing zurueck auf PC 1 getragen.
    # Gefahrlos: der Pfad liegt garantiert unter dem geprueften, nicht-leeren
    # $TransferUnterordner.
    if (Test-Path $vaultZiel) { Remove-Item $vaultZiel -Recurse -Force }
    robocopy $vaultQuelle $vaultZiel /E /R:1 /W:2 /NP /XD ".stversions" ".trash" | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy-Fehler beim Vault-Export (Code $LASTEXITCODE)" }
    $vaultExportOk = $true
    if (Test-Path $vaultMarker) { Remove-Item $vaultMarker -Force }
    Write-Host "Vault-Kopie erstellt aus: $vaultQuelle"
} else {
    Write-Warning "Vault nicht gefunden ('$vaultQuelle') - VaultQuellPfad im Variablenblock pruefen."
    # Marker-Datei ins Paket schreiben - setup-pc2.ps1 wertet sie aus und
    # meldet einen Fehler, damit auf PC 2 kein leerer Ordner entsteht.
    @("Der Export hat KEINEN Vault gefunden (gesucht: '$vaultQuelle').",
      "VaultQuellPfad in export-pc1.ps1 korrekt setzen und den Export erneut ausfuehren,",
      "BEVOR setup-pc2.ps1 auf PC 2 gestartet und Syncthing gekoppelt wird.") |
        Set-Content -Path $vaultMarker -Encoding UTF8
}

# ---------------------------------------------------------------
# Schritt 6: Syncthing + Tailscale auf PC 1 (optional; Syncthing-
# Installer richtet den Autostart per geplanter Aufgabe selbst ein).
# Ggf. UAC bestaetigen.
# Hinweis: Der Autostart greift erst ab der naechsten Anmeldung -
# laeuft Syncthing danach nicht, einmal ueber das Startmenue starten
# oder ab-/anmelden (siehe PLAN.md, Block 1 Schritt 6).
# ---------------------------------------------------------------
if ($SyncthingAufPc1Installieren) {
    winget list --id BillStewart.SyncthingWindowsSetup -e --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installiere Syncthing (bitte ggf. UAC-Abfrage bestaetigen) ..."
        winget install --id BillStewart.SyncthingWindowsSetup -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
        Write-Host "Hinweis: Damit die Syncthing-Oberflaeche (http://127.0.0.1:8384) fuer die Kopplung erreichbar ist, nach dem Export einmal ab- und wieder anmelden ODER Syncthing einmal ueber das Startmenue starten."
        Write-Host "Hinweis: Relay und globale Erkennung in Syncthing eingeschaltet LASSEN (Standard) - nur so synct der Laptop auch unterwegs (zusaetzlich kommt Tailscale)."
    } else {
        Write-Host "Syncthing ist bereits installiert."
    }
}

# Tailscale (beschlossene Architektur: auf BEIDEN PCs; ersetzt Portfreigaben
# fuer den Fall 'Laptop unterwegs'). Login danach manuell (PLAN.md, Restliste).
if ($TailscaleAufPc1Installieren) {
    winget list --id Tailscale.Tailscale -e --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installiere Tailscale (bitte ggf. UAC-Abfrage bestaetigen) ..."
        winget install --id Tailscale.Tailscale -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
        Write-Host "Hinweis: Tailscale nach der Installation einmal starten und mit dem Tailscale-Konto anmelden (PLAN.md, Restliste)."
    } else {
        Write-Host "Tailscale ist bereits installiert."
    }
}

# ---------------------------------------------------------------
# Schritt 6b: Naechtlicher Backup-Task auch auf PC 1 (Beschluss laut
# Dossier: Task bevorzugt auf PC 2, auf PC 1 ZUSAETZLICH mit
# Erreichbarkeitspruefung - ist der Laptop unterwegs, wird der Lauf
# sauber uebersprungen, Exit 0). Gesichert werden Vault UND die oben
# gefundenen Projektordner ($repoPfade), versioniert in datierte
# Ordner, bewusst KEIN /MIR. Eigene Zielordner (...-PC1), damit sich
# die Staende beider PCs nicht vermischen. Die Aufgabe wird fuer den
# aktuellen Benutzer angelegt (geht ohne Adminrechte).
# ---------------------------------------------------------------
if ($BackupAuchAufPc1 -and $NasHost -ne "") {
    try {
        $pc1BackupWurzel = $BackupZielWurzelPc1
        if ([string]::IsNullOrWhiteSpace($pc1BackupWurzel)) {
            $pc1BackupWurzel = "\\$NasHost\$NasShare\Backup\SecondBrain-PC1"
        }
        $backupEltern = Split-Path $pc1BackupWurzel -Parent
        if ([string]::IsNullOrWhiteSpace($backupEltern)) {
            $pc1ProjekteWurzel = ($pc1BackupWurzel + "-Projekte")
        } else {
            $pc1ProjekteWurzel = Join-Path $backupEltern "Projekte-PC1"
        }
        $skriptOrdner = "C:\Skripte"
        New-Item -ItemType Directory -Force -Path $skriptOrdner | Out-Null
        $backupSkriptPfad = Join-Path $skriptOrdner "Backup-SecondBrain.ps1"
        $vorlage = @'
# Backup-SecondBrain.ps1 - automatisch erzeugt von export-pc1.ps1 (PC 1)
# Sichert Vault UND Projektordner taeglich in datierte Ordner auf dem NAS
# (Beschluss: 'Vault + Projekte naechtlich aufs NAS').
# VERSIONIERT (datierte Tagesstaende), bewusst KEIN /MIR-Spiegel.
# Ist das NAS nicht erreichbar (Laptop unterwegs), wird sauber uebersprungen.
$VaultPfad        = "__VAULTPFAD__"
$BackupWurzel     = "__BACKUPWURZEL__"
$ProjekteWurzel   = "__PROJEKTEWURZEL__"
$ProjekteQuellen  = @(__PROJEKTQUELLEN__)
$AufbewahrungTage = __TAGE__
$LogDatei  = Join-Path $env:LOCALAPPDATA "SecondBrain-Backup.log"
# Erreichbarkeitspruefung: Ist das NAS nicht erreichbar (Laptop unterwegs,
# NAS aus), wird der Lauf sauber uebersprungen (Exit 0, kein Fehlerspam) -
# der naechste Trigger (taeglich bzw. Anmeldung) holt das Backup nach.
$freigabe = $BackupWurzel
if ($BackupWurzel -match '^(\\\\[^\\]+\\[^\\]+)') { $freigabe = $Matches[1] }
if (-not (Test-Path $freigabe)) {
    Add-Content -Path $LogDatei -Value ("UEBERSPRUNGEN: NAS-Freigabe '" + $freigabe + "' nicht erreichbar am " + (Get-Date) + " - Backup wird beim naechsten Trigger nachgeholt.")
    exit 0
}
function Sichere-Versioniert([string]$Quelle, [string]$ZielWurzel) {
    # Wachklausel 1: NIEMALS eine leere Quelle sichern - sonst wuerde die
    # Aufbewahrung brauchbare Staende wegrotieren.
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
        if ($repoPfade.Count -gt 0) {
            $projektQuellenText = '"' + ((@($repoPfade) | ForEach-Object { "$_" -replace '"', '' }) -join '", "') + '"'
        }
        $vorlage = $vorlage.Replace("__VAULTPFAD__", $VaultPfad).Replace("__BACKUPWURZEL__", $pc1BackupWurzel).Replace("__PROJEKTEWURZEL__", $pc1ProjekteWurzel).Replace("__PROJEKTQUELLEN__", $projektQuellenText).Replace("__TAGE__", [string]$AufbewahrungTage)
        Set-Content -Path $backupSkriptPfad -Value $vorlage -Encoding UTF8

        $aktion    = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$backupSkriptPfad`""
        $ausloeser = @((New-ScheduledTaskTrigger -Daily -At $BackupUhrzeit), (New-ScheduledTaskTrigger -AtLogOn))
        # KEIN knappes Zeitlimit: Jeder Tagesstand ist eine VOLLKOPIE - grosse
        # Videoprojekt-Ordner brauchen auf die EX2 (60-110 MB/s) leicht mehrere
        # Stunden. Ein 1-Stunden-Limit wuerde robocopy mitten im Lauf killen
        # und unvollstaendige Staende hinterlassen, die wie gueltige aussehen.
        # 12 Stunden = grosszuegige Obergrenze gegen echte Haenger.
        $optionen  = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12)
        # -Force macht den Aufruf idempotent (ueberschreibt eine vorhandene Aufgabe gleichen Namens)
        Register-ScheduledTask -TaskName "SecondBrain-Backup" -Action $aktion -Trigger $ausloeser -Settings $optionen -Force | Out-Null
        Write-Host "Backup-Aufgabe 'SecondBrain-Backup' auf PC 1 registriert (taeglich $BackupUhrzeit + Nachhol-Lauf bei Anmeldung; ueberspringt sauber, wenn das NAS nicht erreichbar ist - z.B. unterwegs)."
        Write-Host "Backup-Ziele PC 1 (versioniert): $pc1BackupWurzel (Vault) und $pc1ProjekteWurzel (Projekte)."
    } catch {
        Write-Warning ("Backup-Aufgabe auf PC 1 konnte nicht angelegt werden: " + $_.Exception.Message)
        Write-Warning "Kein Beinbruch fuer den Export selbst - aber laut Beschluss soll PC 1 zusaetzlich sichern. Bitte C:\Skripte\Backup-SecondBrain.ps1 pruefen und die Aufgabe ggf. von Hand in der Aufgabenplanung anlegen."
    }
}

# ---------------------------------------------------------------
# Schritt 7: Manifest (Versionsstand von PC 1 zum spaeteren Vergleich)
# ---------------------------------------------------------------
$claudeVersion = ""; $gitVersion = ""; $nodeVersion = ""
# stderr-Umleitungen nativer Befehle unter EAP=Stop absichern (PS 5.1)
$alteEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
if (Get-Command claude -ErrorAction SilentlyContinue) { $claudeVersion = (& claude --version 2>$null | Out-String).Trim() }
if (Get-Command git -ErrorAction SilentlyContinue)    { $gitVersion    = (& git --version 2>$null | Out-String).Trim() }
if (Get-Command node -ErrorAction SilentlyContinue)   { $nodeVersion   = (& node --version 2>$null | Out-String).Trim() }
$ErrorActionPreference = $alteEap
$manifest = [ordered]@{
    ExportDatum   = (Get-Date).ToString("s")
    Computer      = $env:COMPUTERNAME
    ClaudeVersion = $claudeVersion
    GitVersion    = $gitVersion
    NodeVersion   = $nodeVersion
    VaultQuelle   = $vaultQuelle
}
$manifest | ConvertTo-Json | Out-File -FilePath (Join-Path $TransferPfad "manifest.json") -Encoding UTF8

Write-Host ""
if ($vaultExportOk) {
    Write-Host "=== Export fertig: $TransferPfad ===" -ForegroundColor Green
} else {
    Write-Host "=== Export beendet - ABER UNVOLLSTAENDIG: $TransferPfad ===" -ForegroundColor Yellow
    Write-Warning "ACHTUNG: vault-kopie fehlt im Paket (das Second Brain!). VaultQuellPfad im Variablenblock setzen und export-pc1.ps1 erneut ausfuehren, BEVOR setup-pc2.ps1 gestartet wird."
}
Write-Host "Bitte kurz durchsehen: nicht-automatisch.txt (manuelle Restliste fuer PC 2)."
Write-Host "Naechster Schritt: setup-pc2.ps1 auf PC 2 ALS ADMINISTRATOR ausfuehren (Anleitung: PLAN.md, Block 2)."
