# ============================================================
# export-pc1.ps1
# Laeuft auf PC 1 (normale Benutzerrechte genuegen).
#
# Sammelt alles, was PC 2 braucht, und legt es als Migrationspaket
# auf dem NAS ab (Fallback: USB-Stick):
#   apps.json                     winget-Programmliste (autom. Import auf PC 2)
#   programme-komplett.txt        ALLE Programme laut Registry (Sicherheitsnetz)
#   nicht-automatisch.txt         Programme, die winget vermutlich nicht kennt
#   export-warnungen.txt          Original-Warnungen von winget export
#   dot-claude\                   Claude-Code-Konfiguration OHNE Secrets
#   mcp-servers.json              globale MCP-Server aus %USERPROFILE%\.claude.json
#   gitconfig.txt                 Git-Konfiguration (mit Token-Warnscan)
#   repo-liste.txt                Git-Repos unter $ProjektWurzel (Pfad + Remote,
#                                 eingebettete Zugangsdaten in URLs maskiert)
#   projekt-konfig-fundliste.txt  CLAUDE.md/.mcp.json in Projekten (Kontrolle)
#   vault-kopie\                  Kopie des Second Brain (Startstand fuer PC 2)
#   VAULT-FEHLT.txt               Marker, falls KEIN Vault gefunden wurde
#                                 (setup-pc2.ps1 meldet das als Fehler)
#   manifest.json                 Versionsstaende von PC 1
#
# Nebenbei: bindet das NAS als Netzlaufwerk ein (cmdkey + net use)
# und installiert optional Syncthing auf PC 1.
#
# Idempotent: mehrfaches Ausfuehren ist unkritisch (kopiert nie einen
# alten Stand ueber neuere Dateien).
# Als UTF-8 mit BOM speichern. Kompatibel mit Windows PowerShell 5.1.
# Umlaute in Ausgaben bewusst als ae/oe/ue geschrieben.
# Start: powershell -ExecutionPolicy Bypass -File C:\Skripte\export-pc1.ps1
# ============================================================

# ==================== VARIABLEN (EINMAL AUSFUELLEN) ====================
$NasHost             = "192.168.1.20"    # IP oder Name des NAS (z.B. "DISKSTATION"); "" = kein NAS
$NasShare            = "daten"           # Name der SMB-Freigabe auf dem NAS
$NasUser             = "lichtflut"       # NAS-Benutzerkonto (kein Gastzugriff!)
$Laufwerk            = "N"               # Laufwerksbuchstabe, auf BEIDEN PCs gleich (muss frei sein)
$VaultPfad           = "C:\SecondBrain"  # kanonischer Second-Brain-Pfad (auf BEIDEN PCs gleich)
$VaultQuellPfad      = ""                # wo der Vault HEUTE liegt, z.B. "D:\Notizen\Vault"; "" = schon unter $VaultPfad
$ProjektWurzel       = ""                # Ordner mit den Git-Repos, z.B. "D:\Projekte"; "" = ueberspringen
$TransferUnterordner = "pc2-umzug"       # Ordnername auf der NAS-Freigabe fuer das Migrationspaket (NICHT leer lassen!)
$UsbFallbackPfad     = ""                # z.B. "E:\pc2-umzug" - wird genutzt, wenn das NAS nicht erreichbar ist
$SyncthingAufPc1Installieren = $true     # Syncthing auch auf PC 1 installieren (Vault-Sync)
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
    # Win32-Argumentregel: Backslashes am Passwort-Ende verdoppeln, sonst
    # 'schluckt' der letzte Backslash das schliessende Anfuehrungszeichen
    # und es wird ein falsches Passwort gespeichert.
    $pwArg = $Passwort -replace '(\\+)$', '$1$1'
    cmdkey /add:"$Ziel" /user:"$Benutzer" /pass:"$pwArg" | Out-Null
    return $true
}

Write-Host "=== export-pc1: Start ===" -ForegroundColor Cyan

# ---------------------------------------------------------------
# Schritt 0: NAS als Netzlaufwerk einbinden (idempotent).
# Das Passwort landet NUR im Windows-Anmeldeinformations-Manager,
# nie im Skript und nie in einer Datei. (Es taucht beim Speichern
# einmalig kurz als Prozessargument von cmdkey auf - Details und
# Alternative siehe PLAN.md, Abschnitt 9.)
# ---------------------------------------------------------------
if ($NasHost -ne "") {
    $UncFreigabe = "\\$NasHost\$NasShare"

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
            # Haeufigste Ursache: beim ersten Lauf falsch eingetipptes Passwort
            # gespeichert -> Eintrag verwerfen, neu abfragen, EINMAL wiederholen.
            Write-Warning "Verbindung fehlgeschlagen - gespeicherte Zugangsdaten werden verworfen, bitte Passwort erneut eingeben."
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
        $ErrorActionPreference = $alteEap
        if ($netExit -ne 0) {
            throw "Laufwerk ${Laufwerk}: konnte nicht mit $UncFreigabe verbunden werden (net use Exit-Code $netExit). Notausgang: 'cmdkey /delete:$NasHost' ausfuehren und Skript neu starten."
        }
        Write-Host "Laufwerk ${Laufwerk}: verbunden mit $UncFreigabe."
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
Write-Host "Programmliste exportiert (apps.json, programme-komplett.txt, nicht-automatisch.txt)."

# ---------------------------------------------------------------
# Schritt 3: Claude-Code-Konfiguration exportieren - OHNE Secrets.
# Ausgeschlossen: .credentials.json (OAuth-Tokens!), history.jsonl,
# sowie reiner Maschinen-/Sitzungszustand (Transkripte, Caches, ...).
# ---------------------------------------------------------------
if (Test-Path $ClaudeDir) {
    $zielDotClaude = Join-Path $TransferPfad "dot-claude"
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

    # Sicherheits-Scan: auch settings.json/settings.local.json koennen Secrets
    # enthalten (env-Bloecke mit API-Keys, apiKeyHelper). Bei Treffern deutlich
    # warnen - garantiert 'secret-frei' ist das Paket sonst nicht.
    $jsonDateien = Get-ChildItem -Path $zielDotClaude -Recurse -Include *.json -File -ErrorAction SilentlyContinue
    $scanTreffer = @()
    if ($jsonDateien) {
        $scanTreffer = @($jsonDateien | Select-String -Pattern 'sk-ant-','API_KEY','TOKEN','apiKeyHelper' -ErrorAction SilentlyContinue)
    }
    if ($scanTreffer.Count -gt 0) {
        Write-Warning "Das dot-claude-Paket enthaelt vermutlich Secrets - Migrationspaket nach dem Setup auf PC 2 UNBEDINGT loeschen!"
        $scanTreffer | Select-Object -ExpandProperty Path -Unique | ForEach-Object {
            Write-Warning ("  Betroffene Datei: " + $_)
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
    Copy-Item $gitconfig $gitconfigZiel -Force
    Write-Host ".gitconfig exportiert."
    # Sicherheits-Scan: die .gitconfig kann eingebettete Tokens enthalten
    # (insteadOf-Regeln oder URLs der Form https://user:TOKEN@github.com/...).
    # Sie landet unverschluesselt auf NAS/USB - bei Treffern deutlich warnen.
    $gitTreffer = @(Select-String -Path $gitconfigZiel -Pattern $tokenMuster -ErrorAction SilentlyContinue)
    if ($gitTreffer.Count -gt 0) {
        Write-Warning "gitconfig.txt enthaelt vermutlich eingebettete Zugangsdaten/Tokens (URL-Credentials oder PAT)!"
        Write-Warning "Empfehlung: Token aus der .gitconfig auf PC 1 entfernen (der Git Credential Manager uebernimmt das sicher) und den Export wiederholen. Migrationspaket nach dem Setup UNBEDINGT loeschen."
    }
}
if ($ProjektWurzel -ne "" -and (Test-Path $ProjektWurzel)) {
    $repoZeilen = @("# Git-Repos auf PC 1 (Pfad | Remote 'origin') - auf PC 2 bei Bedarf neu klonen", "")
    $kandidaten = @()
    $kandidaten += Get-Item $ProjektWurzel
    $kandidaten += Get-ChildItem -Path $ProjektWurzel -Directory -Recurse -Depth 3 -ErrorAction SilentlyContinue
    $gitDa = [bool](Get-Command git -ErrorAction SilentlyContinue)
    foreach ($ordner in $kandidaten) {
        if (Test-Path (Join-Path $ordner.FullName ".git")) {
            $remote = ""
            if ($gitDa) {
                # 'git config --get remote.origin.url' schreibt bei fehlendem
                # origin nichts auf stderr (nur Exit-Code 1). Trotzdem EAP
                # absichern: stderr-Umleitung unter EAP=Stop ist in PS 5.1 fatal.
                $alteEap = $ErrorActionPreference
                $ErrorActionPreference = "Continue"
                $remote = (& git -C $ordner.FullName config --get remote.origin.url 2>$null | Out-String).Trim()
                $ErrorActionPreference = $alteEap
                # Sicherheits-Maskierung: eingebettete Zugangsdaten in Remote-URLs
                # (https://user:TOKEN@host/...) NICHT ins Paket schreiben - fuer
                # das Neu-Klonen auf PC 2 reicht die bereinigte URL.
                $remote = $remote -replace '://[^/@]+:[^@/]+@', '://***@'
            }
            $repoZeilen += ("{0} | {1}" -f $ordner.FullName, $remote)
        }
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
    Get-ChildItem $ProjektWurzel -Recurse -Depth 4 -Include "CLAUDE.md",".mcp.json" -File -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName |
        Out-File -FilePath (Join-Path $TransferPfad "projekt-konfig-fundliste.txt") -Encoding UTF8
    Write-Host "Repo-Liste und Projekt-Konfig-Fundliste erstellt."
}

# ---------------------------------------------------------------
# Schritt 5: Second Brain (Vault)
# 5a) Vault auf PC 1 einmalig auf den kanonischen Pfad bringen,
#     damit Syncthing auf beiden PCs denselben Pfad nutzt.
# 5b) Kopie als Startstand fuer PC 2 ins Migrationspaket legen.
# ---------------------------------------------------------------
if ($VaultQuellPfad -ne "" -and (Test-Path $VaultQuellPfad) -and ($VaultQuellPfad -ne $VaultPfad)) {
    # Wiederholungsschutz: NICHT auf '.obsidian' pruefen (das Second Brain
    # muss kein Obsidian-Vault sein), sondern darauf, ob das Ziel schon
    # Dateien enthaelt. Sonst wuerde jeder erneute Lauf einen alten Stand
    # ueber zwischenzeitliche Aenderungen kopieren.
    $zielBelegt = $false
    if (Test-Path $VaultPfad) {
        $zielBelegt = ((Get-ChildItem -Path $VaultPfad -Force -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
    }
    if ($zielBelegt) {
        Write-Host "Vault-Uebernahme uebersprungen: $VaultPfad enthaelt bereits Dateien (Uebernahme war offenbar schon erfolgt)."
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
            Write-Host "Alter Vault-Ordner umbenannt in '$altName'. Obsidian/Editor kuenftig NUR noch mit $VaultPfad oeffnen (siehe PLAN.md, Block 1, Schritt 7)."
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
# Schritt 6: Syncthing auf PC 1 (optional; Installer richtet den
# Autostart per geplanter Aufgabe selbst ein). Ggf. UAC bestaetigen.
# Hinweis: Der Autostart greift erst ab der naechsten Anmeldung -
# laeuft Syncthing danach nicht, einmal ueber das Startmenue starten
# oder ab-/anmelden (siehe PLAN.md, Block 1 Schritt 5).
# ---------------------------------------------------------------
if ($SyncthingAufPc1Installieren) {
    winget list --id BillStewart.SyncthingWindowsSetup -e --accept-source-agreements | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installiere Syncthing (bitte ggf. UAC-Abfrage bestaetigen) ..."
        winget install --id BillStewart.SyncthingWindowsSetup -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
        Write-Host "Hinweis: Damit die Syncthing-Oberflaeche (http://127.0.0.1:8384) fuer die Kopplung erreichbar ist, nach dem Export einmal ab- und wieder anmelden ODER Syncthing einmal ueber das Startmenue starten."
    } else {
        Write-Host "Syncthing ist bereits installiert."
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
