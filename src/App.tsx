import { useEffect, useMemo, useRef, useState } from 'react';
import { useTournament } from './useTournament';
import { PlayerList } from './components/PlayerList';
import { SettingsForm } from './components/SettingsForm';
import { ScheduleView } from './components/ScheduleView';
import { BracketView } from './components/BracketView';
import { DataPanel } from './components/DataPanel';
import { SharingGuide } from './components/SharingGuide';
import { NowPlaying } from './components/NowPlaying';
import { Splash, StelzenLogoKlein } from './components/Splash';
import {
  checkSetup,
  createPlayer,
  isFinished,
  nextYear,
  performDraw,
  recompute,
  progress,
} from './engine/tournament';
import { playerNames } from './engine/schedule';
import { canWrite, publishState, type PublishResult } from './live';
import { useCloud } from './useCloud';
import type { TournamentSettings } from './engine/types';

type Tab = 'vorbereitung' | 'spielplan' | 'baum';

const TABS: { id: Tab; label: string }[] = [
  { id: 'vorbereitung', label: 'Vorbereitung' },
  { id: 'spielplan', label: 'Spielplan' },
  { id: 'baum', label: 'Turnierbaum' },
];

const TAB_KEY = 'stelzengaudi:tab';

function live0(): boolean {
  return typeof document !== 'undefined' && Boolean(document.getElementById('turnier-tpl'));
}

function restoreTab(): Tab {
  try {
    // localStorage statt sessionStorage: Handys werfen Tabs über Nacht weg,
    // und mitten im Turnier will niemand wieder auf der Vorbereitung landen.
    const stored = localStorage.getItem(TAB_KEY);
    if (stored === 'spielplan' || stored === 'baum' || stored === 'vorbereitung') return stored;
  } catch {
    /* dann eben nicht */
  }
  return 'vorbereitung';
}

function CloudBanner({ state, onRetry }: { state: import('./useCloud').CloudState; onRetry: () => void }) {
  if (state === 'verbinde') {
    return (
      <div className="note note--info no-print" role="status">
        Verbinde mit dem gemeinsamen Stand …
      </div>
    );
  }
  if (state === 'laeuft') {
    return (
      <div className="note note--ok no-print" role="status">
        Wird an alle übertragen …
      </div>
    );
  }
  if (state === 'ueberholt') {
    return (
      <div className="note note--warn no-print" role="alert">
        Jemand war gleichzeitig dran – der neuere Stand wurde übernommen. Bitte die eigene
        Eingabe prüfen und notfalls wiederholen.
      </div>
    );
  }
  if (state === 'netz') {
    return (
      <div className="note note--warn no-print" role="alert">
        Gerade keine Verbindung – Änderungen bleiben auf diesem Gerät und gehen raus, sobald
        wieder Netz da ist.{' '}
        <button className="btn btn--small" type="button" onClick={onRetry}>
          Jetzt versuchen
        </button>
      </div>
    );
  }
  return (
    <div className="note note--ok no-print" role="status">
      Live für alle: Wer den Link hat, sieht diesen Stand und kann eintragen.
    </div>
  );
}

function LiveBanner({
  state,
  onRetry,
}: {
  state: PublishResult | 'laeuft' | 'pruefe';
  onRetry: () => void;
}) {
  if (state === 'pruefe') {
    return (
      <div className="note note--info no-print" role="status">
        Berechtigung wird geprüft …
      </div>
    );
  }
  if (state === 'schreibgeschuetzt') {
    return (
      <div className="note note--info no-print" role="status">
        Mitlesen: Der Stand aktualisiert sich von selbst. Eintragen kann nur, wer Bearbeitungsrecht hat.
      </div>
    );
  }
  if (state === 'laeuft') {
    return (
      <div className="note note--ok no-print" role="status">
        Wird an alle übertragen …
      </div>
    );
  }
  if (state === 'konflikt') {
    return (
      <div className="note note--warn no-print" role="status">
        Jemand anderes hat gerade etwas eingetragen. Diese Ansicht lädt gleich den neueren Stand.
      </div>
    );
  }
  if (state === 'ueberlastet' || state === 'fehler') {
    return (
      <div className="note note--warn no-print" role="alert">
        Die letzte Änderung ist noch nicht bei allen angekommen – wird gleich erneut versucht.{' '}
        <button className="btn btn--small" type="button" onClick={onRetry}>
          Jetzt erneut übertragen
        </button>
      </div>
    );
  }
  if (state === 'zu-gross') {
    return (
      <div className="note note--error no-print" role="alert">
        Der Stand ist zu groß zum Übertragen. Bitte exportieren und ein kleineres Turnier anlegen.
      </div>
    );
  }
  return (
    <div className="note note--ok no-print" role="status">
      Live: Alle mit dem Link sehen diesen Stand.
    </div>
  );
}

function Preview({
  preview,
}: {
  preview: NonNullable<ReturnType<typeof checkSetup>['preview']>;
}) {
  const spiele = (n: number): string => `${n} ${n === 1 ? 'Spiel' : 'Spiele'}`;
  const teile: string[] = [];
  if (preview.playInCount > 0) {
    teile.push(
      `${preview.playInCount} ${preview.playInCount === 1 ? 'Vorrundenspiel' : 'Vorrundenspiele'}`,
    );
  }
  teile.push(`Hauptfeld mit ${preview.mainSize} Plätzen`);
  if (preview.consolationSize >= 2) teile.push(`Trostrunde mit ${preview.consolationSize} Plätzen`);
  return (
    <>
      {teile.join(', ')}. Insgesamt {spiele(preview.totalMatches)}.
    </>
  );
}

export default function App() {
  const { tournament, update, apply, undo, adoptRemote, canUndo, reset, saveState, contentRevision, pendingGroup, live } =
    useTournament();
  const [tab, setTab] = useState<Tab>(() => restoreTab());
  // Gemeinsamer Stand über den konfigurierten Dienst – überall außer auf der
  // Claude-Live-Seite, die ihren eigenen Mechanismus mitbringt.
  const cloud = useCloud({ tournament, contentRevision, adoptRemote, enabled: !live });
  const [liveState, setLiveState] = useState<PublishResult | 'laeuft' | 'pruefe'>(live0() ? 'pruefe' : 'ok');
  const publishedRevision = useRef(0);
  const retries = useRef(0);
  const drawn = tournament.matches.length > 0;
  const check = useMemo(() => checkSetup(tournament), [tournament]);
  const stats = progress(tournament);
  const names = useMemo(() => playerNames(tournament.players), [tournament.players]);

  // Beim Öffnen klären, ob diese Ansicht schreiben darf. Bis dahin gilt sie
  // als schreibgeschützt – sonst tippt jemand Ergebnisse, die nie ankommen.
  useEffect(() => {
    if (!live) return;
    let active = true;
    void canWrite().then((allowed) => {
      if (!active) return;
      setLiveState((current) => (current === 'pruefe' ? (allowed ? 'ok' : 'schreibgeschuetzt') : current));
    });
    return () => {
      active = false;
    };
  }, [live]);

  // Auf der Live-Seite jede inhaltliche Änderung an alle weitergeben.
  // Tippen (laufende Gruppe) wird entprellt: jede Veröffentlichung lädt alle
  // Ansichten neu – ein Publish je Tastendruck wäre unbenutzbar.
  useEffect(() => {
    if (!live || contentRevision === 0 || contentRevision === publishedRevision.current) return;
    if (liveState === 'pruefe' || liveState === 'laeuft') return;
    const delay = pendingGroup !== null ? 1500 : 0;
    const timer = setTimeout(() => {
      publishedRevision.current = contentRevision;
      retries.current = 0;
      setLiveState('laeuft');
      void publishState(tournament).then(setLiveState);
    }, delay);
    return () => clearTimeout(timer);
  }, [live, contentRevision, tournament, liveState, pendingGroup]);

  // Gescheiterte Übertragungen ein paar Mal automatisch wiederholen.
  useEffect(() => {
    if (!live) return;
    if (liveState === 'konflikt') {
      // Jemand anderes war schneller: die Plattform lädt bereits nach.
      return;
    }
    if (liveState !== 'fehler' && liveState !== 'ueberlastet') return;
    if (retries.current >= 3) return;
    retries.current += 1;
    const wait = [1500, 4000, 9000][retries.current - 1];
    const timer = setTimeout(() => {
      setLiveState('laeuft');
      void publishState(tournament).then(setLiveState);
    }, wait);
    return () => clearTimeout(timer);
  }, [live, liveState, tournament]);

  const readOnly = live && (liveState === 'schreibgeschuetzt' || liveState === 'pruefe');
  const retryPublish = (): void => {
    retries.current = 0;
    setLiveState('laeuft');
    void publishState(tournament).then(setLiveState);
  };

  // Nach einem Rückgängig ohne Spielplan nicht auf einem toten Tab stehen bleiben.
  useEffect(() => {
    if (!drawn && tab !== 'vorbereitung') setTab('vorbereitung');
  }, [drawn, tab]);

  // Bereich merken: nach dem Neuladen – und im Live-Modus nach jedem
  // Veröffentlichen – landet man sonst wieder auf der Vorbereitung.
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* dann eben nicht */
    }
  }, [tab]);

  const draw = (): void => {
    if (drawn && !confirm('Neu auslosen? Der bisherige Spielplan und alle Ergebnisse gehen verloren.')) return;
    apply((t) => performDraw(t));
    setTab('spielplan');
  };

  return (
    <div className="app">
      <Splash />
      <header className="topbar">
        <div className="topbar__row">
          <div className="topbar__title">
            <StelzenLogoKlein className="topbar__logo" />
            <h1>{tournament.settings.name || 'Stelzengaudi Federballturnier'}</h1>
          </div>
          <div className="topbar__actions no-print">
            <button className="btn btn--small" type="button" onClick={() => window.print()}>
              Drucken
            </button>
            <button className="btn btn--small" type="button" onClick={undo} disabled={!canUndo}>
              ↩ Rückgängig
            </button>
          </div>
        </div>

        {drawn && (
          <div className="progress no-print">
            <div
              className="progress__bar"
              role="progressbar"
              aria-valuenow={stats.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Turnierfortschritt"
            >
              <div className="progress__fill" style={{ width: `${stats.percent}%` }} />
            </div>
            <div className="progress__label" aria-live="polite">
              {stats.played} von {stats.total} {stats.total === 1 ? 'Spiel' : 'Spielen'} gespielt
            </div>
          </div>
        )}

        {live && <LiveBanner state={liveState} onRetry={retryPublish} />}
        {!live && cloud.state !== 'aus' && <CloudBanner state={cloud.state} onRetry={cloud.retry} />}

        {saveState !== 'ok' && (
          <div className="note note--warn no-print" role="status">
            {saveState === 'voll'
              ? 'Der Speicher dieses Browsers ist voll – bitte exportieren, sonst geht der Stand verloren.'
              : 'Dieser Browser speichert gerade nichts (z. B. privater Modus). Bitte zwischendurch exportieren.'}
          </div>
        )}

        <nav className="tabs no-print" aria-label="Bereiche">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="tab"
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => setTab(t.id)}
              disabled={t.id !== 'vorbereitung' && !drawn}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {drawn && tab !== 'vorbereitung' && (
          <NowPlaying
            tournament={tournament}
            names={names}
            onJump={(matchId) => {
              setTab('spielplan');
              // Erst rendern lassen, dann anspringen.
              requestAnimationFrame(() => {
                document.getElementById(`match-${matchId}`)?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                });
              });
            }}
          />
        )}

        <div hidden={tab !== 'vorbereitung'}>
          <PlayerList
            tournament={tournament}
            locked={drawn || readOnly}
            readOnly={readOnly}
            onAddMany={(newNames, asChampion) =>
              apply((t) => ({
                ...t,
                players: [...t.players, ...newNames.map((n) => createPlayer(n, asChampion))],
              }))
            }
            onRename={(id, name) =>
              apply(
                (t) => ({ ...t, players: t.players.map((p) => (p.id === id ? { ...p, name } : p)) }),
                `name:${id}`,
              )
            }
            onSetSong={(id, song) =>
              apply(
                (t) => ({ ...t, players: t.players.map((p) => (p.id === id ? { ...p, song } : p)) }),
                `song:${id}`,
              )
            }
            onToggleChampion={(id) =>
              apply((t) => ({
                ...t,
                players: t.players.map((p) => (p.id === id ? { ...p, isChampion: !p.isChampion } : p)),
              }))
            }
            onRemove={(id) => apply((t) => ({ ...t, players: t.players.filter((p) => p.id !== id) }))}
            onRemoveAll={() => apply((t) => ({ ...t, players: [] }))}
          />

          <SettingsForm
            settings={tournament.settings}
            locked={drawn || readOnly}
            readOnly={readOnly}
            onChange={(settings: TournamentSettings, group?: string) =>
              apply((t) => ({ ...t, settings }), group)
            }
          />

          <section className="card">
            <h2>Auslosen</h2>
            <p className="muted">
              Verloren heißt raus – wer sein erstes Spiel verliert, spielt aber in der
              Trostrunde weiter. Passt die Personenzahl nicht ins Hauptfeld, spielen die
              Überzähligen eine Vorrunde; die Vorjahresgewinner bleiben davon verschont,
              solange genug direkte Plätze da sind, und stehen im Baum so weit auseinander
              wie möglich.
            </p>

            {check.preview && check.errors.length === 0 && (
              <div className="note note--info">
                <Preview preview={check.preview} />
              </div>
            )}
            {check.errors.length > 0 && (
              <div className="note note--error" role="alert">
                <strong>So kann noch nicht ausgelost werden:</strong>
                <ul>
                  {check.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {check.warnings.length > 0 && (
              <div className="note note--warn">
                <ul>
                  {check.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="btn-row">
              <button
                className="btn btn--primary btn--big"
                type="button"
                onClick={draw}
                disabled={check.errors.length > 0 || readOnly}
              >
                🎲 {drawn ? 'Neu auslosen' : 'Jetzt auslosen'}
              </button>
            </div>

            {drawn && (
              <>
                <p className="muted" style={{ marginTop: 12 }}>
                  Ausgelost am {new Date(tournament.drawnAt ?? Date.now()).toLocaleString('de-DE')} · Losnummer{' '}
                  {tournament.drawSeed}
                </p>
                {tournament.drawWarnings.length > 0 && (
                  <div className="note note--warn">
                    <ul>
                      {tournament.drawWarnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>

          <SharingGuide />

          <DataPanel
            tournament={tournament}
            readOnly={readOnly}
            onImport={(t) => {
              // Importierte Daten einmal nachrechnen – sie können von Hand verändert sein.
              update(recompute(t));
              setTab(t.matches.length > 0 ? 'spielplan' : 'vorbereitung');
            }}
            onReset={reset}
            onNextYear={() => {
              update(nextYear(tournament));
              setTab('vorbereitung');
            }}
            canStartNextYear={isFinished(tournament)}
          />
        </div>

        <div hidden={tab !== 'spielplan'}>
          <ScheduleView tournament={tournament} readOnly={readOnly} apply={apply} />
        </div>

        <div hidden={tab !== 'baum'}>
          <BracketView tournament={tournament} />
        </div>
      </main>

      <footer className="footer">
        <p>
          {live
            ? 'Stelzengaudi Federballturnier · Der Stand wird über den geteilten Link an alle weitergegeben.'
            : 'Stelzengaudi Federballturnier · Alles bleibt auf diesem Gerät. Zum Sichern bitte exportieren.'}
        </p>
      </footer>
    </div>
  );
}
