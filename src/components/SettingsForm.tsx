import type { TournamentSettings } from '../engine/types';
import { LIMITS } from '../engine/tournament';

interface Props {
  settings: TournamentSettings;
  locked: boolean;
  readOnly: boolean;
  /**
   * `group` fasst aufeinanderfolgende Änderungen desselben Feldes zu einem
   * einzigen Rückgängig-Schritt zusammen (z.B. beim Tippen des Namens).
   */
  onChange: (settings: TournamentSettings, group?: string) => void;
}

export function SettingsForm({ settings, locked, readOnly, onChange }: Props) {
  const set = <K extends keyof TournamentSettings>(key: K, value: TournamentSettings[K], group?: string): void =>
    onChange({ ...settings, [key]: value }, group);
  const setScoring = <K extends keyof TournamentSettings['scoring']>(
    key: K,
    value: TournamentSettings['scoring'][K],
  ): void => onChange({ ...settings, scoring: { ...settings.scoring, [key]: value } });

  return (
    <section className="card">
      <h2>Einstellungen</h2>

      <div className="grid grid--2">
        <div>
          <label htmlFor="tname">Name des Turniers</label>
          <input
            id="tname"
            type="text"
            value={settings.name}
            maxLength={LIMITS.titleLength}
            disabled={readOnly}
            onChange={(e) => set('name', e.target.value, 'turniername')}
          />
        </div>
        <div>
          <label htmlFor="courts">Felder gleichzeitig</label>
          <input
            id="courts"
            type="number"
            min={1}
            max={LIMITS.courts}
            value={settings.courts}
            disabled={locked || readOnly}
            onChange={(e) => set('courts', clamp(e.target.value, 1, LIMITS.courts, settings.courts))}
          />
          <p className="hint">Bestimmt, wie viele Spiele gleichzeitig laufen.</p>
        </div>
      </div>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.thirdPlaceMatch}
            disabled={locked || readOnly}
            onChange={(e) => set('thirdPlaceMatch', e.target.checked)}
          />
          <span>Spiel um Platz 3 austragen</span>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.consolation}
            disabled={locked || readOnly}
            onChange={(e) => set('consolation', e.target.checked)}
          />
          <span>Trostrunde für Erstrunden-Verlierer</span>
        </label>
      </div>

      <hr className="rule" />

      <h3>Zählweise</h3>
      {locked && <p className="hint">Nach der Auslosung festgelegt, damit eingetragene Ergebnisse gültig bleiben.</p>}

      <div className="grid grid--2">
        <div>
          <label htmlFor="sets">Gewinnsätze</label>
          <select
            id="sets"
            value={settings.scoring.setsToWin}
            disabled={locked || readOnly}
            onChange={(e) => setScoring('setsToWin', Number(e.target.value) === 2 ? 2 : 1)}
          >
            <option value={1}>1 Gewinnsatz</option>
            <option value={2}>2 Gewinnsätze (zwei von drei)</option>
          </select>
        </div>
        <div>
          <label htmlFor="points">Punkte pro Satz</label>
          <input
            id="points"
            type="number"
            min={1}
            max={LIMITS.pointsPerSet}
            value={settings.scoring.pointsPerSet}
            disabled={locked || readOnly || settings.scoring.freeScoring}
            onChange={(e) =>
              setScoring('pointsPerSet', clamp(e.target.value, 1, LIMITS.pointsPerSet, settings.scoring.pointsPerSet))
            }
          />
        </div>
      </div>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.scoring.winByTwo}
            disabled={locked || readOnly || settings.scoring.freeScoring}
            onChange={(e) => setScoring('winByTwo', e.target.checked)}
          />
          <span>Zwei Punkte Vorsprung nötig</span>
        </label>
        <div>
          <label htmlFor="cap">Obergrenze bei Verlängerung</label>
          <input
            id="cap"
            type="number"
            min={0}
            max={LIMITS.cap}
            value={settings.scoring.cap}
            disabled={locked || readOnly || settings.scoring.freeScoring || !settings.scoring.winByTwo}
            onChange={(e) => setScoring('cap', clamp(e.target.value, 0, LIMITS.cap, settings.scoring.cap))}
          />
          <p className="hint">0 = ohne Obergrenze. Muss mindestens so groß sein wie die Punkte pro Satz.</p>
        </div>
      </div>

      <div className="grid grid--2" style={{ marginTop: 14 }}>
        <div>
          <label htmlFor="endpoints">Punkte ab dem Halbfinale</label>
          <input
            id="endpoints"
            type="number"
            min={1}
            max={LIMITS.pointsPerSet}
            value={settings.scoring.endgamePointsPerSet}
            disabled={locked || readOnly || settings.scoring.freeScoring}
            onChange={(e) =>
              setScoring(
                'endgamePointsPerSet',
                clamp(e.target.value, 1, LIMITS.pointsPerSet, settings.scoring.endgamePointsPerSet),
              )
            }
          />
          <p className="hint">Gilt für Halbfinale, Spiel um Platz 3 und Finale.</p>
        </div>
        {settings.consolation && (
          <div>
            <label htmlFor="trostsets">Gewinnsätze in der Trostrunde</label>
            <select
              id="trostsets"
              value={settings.scoring.consolationSetsToWin}
              disabled={locked || readOnly}
              onChange={(e) => setScoring('consolationSetsToWin', Number(e.target.value) === 2 ? 2 : 1)}
            >
              <option value={1}>1 Gewinnsatz (kurzer Abend)</option>
              <option value={2}>2 Gewinnsätze (zwei von drei)</option>
            </select>
          </div>
        )}
      </div>

      <label className="checkbox" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          checked={settings.scoring.freeScoring}
          disabled={locked || readOnly}
          onChange={(e) => setScoring('freeScoring', e.target.checked)}
        />
        <span>Freie Zählweise – jedes Ergebnis erlaubt, nur ein Sieger muss feststehen</span>
      </label>
    </section>
  );
}

function clamp(raw: string, min: number, max: number, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
