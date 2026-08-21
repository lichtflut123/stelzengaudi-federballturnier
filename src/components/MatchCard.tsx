import { useRef, useState } from 'react';
import type { Id, Match, ScoringRules, SetScore } from '../engine/types';
import { formatScore, maxSets, setsWonBy, validateResult } from '../engine/scoring';
import { REFEREE_KEY, RefereeView } from './RefereeView';

interface Props {
  match: Match;
  names: ReadonlyMap<Id, string>;
  rules: ScoringRules;
  readOnly: boolean;
  onSave: (sets: SetScore[]) => void;
  /** Schiri-Modus: fertige Sätze eines laufenden Spiels. */
  onLiveSets: (sets: SetScore[]) => void;
  onWalkover: (winnerId: Id) => void;
  onClear: () => void;
}

type Row = [string, string];

function prefill(match: Match, count: number): Row[] {
  const rows: Row[] = Array.from({ length: count }, () => ['', ''] as Row);
  // Ohne Endergebnis die bereits gezählten Schiri-Sätze vorbelegen –
  // dann muss beim Korrigieren niemand die Zahlen abtippen.
  const source = match.sets.length > 0 ? match.sets : match.liveSets;
  source.forEach((s, i) => {
    if (i < count) rows[i] = [String(s.a), String(s.b)];
  });
  return rows;
}

export function MatchCard({ match, names, rules, readOnly, onSave, onLiveSets, onWalkover, onClear }: Props) {
  // Zählweise dieses Spiels: die Trostrunde spielt weniger Sätze.
  const matchRules = { ...rules, setsToWin: match.setsToWin };
  const total = maxSets(matchRules);
  // Nach dem Neuladen der Live-Seite öffnet sich der Schiri-Modus von selbst
  // wieder, wenn hier gerade gezählt wurde.
  const [referee, setReferee] = useState(() => {
    try {
      const raw = sessionStorage.getItem(REFEREE_KEY);
      return raw !== null && (JSON.parse(raw) as { matchId?: string }).matchId === match.id;
    } catch {
      return false;
    }
  });
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Row[]>(() => prefill(match, total));
  const [errors, setErrors] = useState<string[]>([]);
  // Die Paarung, für die gerade getippt wird. Ändert sie sich durch eine
  // Korrektur anderswo, dürfen die Zahlen nicht stillschweigend woanders landen.
  const [editedPair, setEditedPair] = useState<[string | null, string | null]>([null, null]);
  const [pairWarning, setPairWarning] = useState(false);
  const firstInput = useRef<HTMLInputElement>(null);

  const nameOf = (side: 'a' | 'b'): string => {
    const id = match[side].playerId;
    if (id) return names.get(id) ?? 'Unbekannt';
    return match[side].source || 'noch offen';
  };
  const aName = nameOf('a');
  const bName = nameOf('b');
  const ready = Boolean(match.a.playerId && match.b.playerId);
  const done = match.winnerId !== null;

  // Werte beim Öffnen setzen, nicht per Effekt: sonst würde eine Änderung an
  // einem anderen Spiel die hier bereits getippten Zahlen überschreiben.
  const open = (): void => {
    setValues(prefill(match, total));
    setErrors([]);
    setEditedPair([match.a.playerId, match.b.playerId]);
    setEditing(true);
    // Fokus synchron im Klick setzen, damit mobile Tastaturen aufgehen.
    queueMicrotask(() => {
      firstInput.current?.focus();
      firstInput.current?.select();
    });
  };

  const pairChanged =
    editing && (editedPair[0] !== match.a.playerId || editedPair[1] !== match.b.playerId);

  const change = (row: number, side: 0 | 1, raw: string): void => {
    const digits = rules.freeScoring ? 3 : 2;
    const clean = raw.replace(/[^0-9]/g, '').slice(0, digits);
    setErrors([]);
    setPairWarning(false);
    setValues((current) =>
      current.map((r, i) => (i === row ? (side === 0 ? [clean, r[1]] : [r[0], clean]) : r)),
    );
  };

  const save = (): void => {
    if (pairChanged) {
      // Erst bestätigen, dass die Zahlen zur neuen Paarung gehören.
      setEditedPair([match.a.playerId, match.b.playerId]);
      setPairWarning(true);
      setErrors([
        `Die Paarung hat sich geändert – jetzt ${aName} gegen ${bName}. Bitte die Punkte prüfen und noch einmal speichern.`,
      ]);
      return;
    }
    setPairWarning(false);
    const sets: SetScore[] = [];
    const problems: string[] = [];
    values.forEach(([a, b], i) => {
      const empty = a === '' && b === '';
      if (empty) return;
      if (a === '' || b === '') {
        problems.push(total > 1 ? `Satz ${i + 1}: Es fehlt eine Punktzahl.` : 'Es fehlt eine Punktzahl.');
        return;
      }
      if (sets.length !== i && total > 1) {
        problems.push(`Satz ${i} wurde übersprungen.`);
      }
      sets.push({ a: Number(a), b: Number(b) });
    });
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    const check = validateResult(sets, matchRules, match.pointsPerSet);
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    onSave(sets);
    setEditing(false);
  };

  const status = done ? 'match--done' : ready ? 'match--open' : 'match--pending';

  return (
    <article className={`match ${status}`} id={`match-${match.id}`}>
      <div className="match__meta">
        <span className="chip">Spiel {match.number}</span>
        <span>{match.label}</span>
        {ready && !done && <span className="chip chip--court">Feld {match.court}</span>}
        {match.outcome === 'kampflos' && <span className="chip chip--live">kampflos</span>}
        {!done && (
          <span className="chip">
            bis {match.pointsPerSet}
            {match.setsToWin === 1 ? ' · 1 Satz' : ''}
          </span>
        )}
        {!done && match.liveSets.length > 0 && (
          <span className="chip chip--live">
            läuft · bisher {match.liveSets.map((s) => `${s.a}:${s.b}`).join(', ')}
          </span>
        )}
      </div>

      <div className="match__side">
        <span className={`match__name ${done && match.winnerId === match.a.playerId ? 'is-winner' : ''} ${match.a.playerId ? '' : 'is-placeholder'}`}>
          {aName}
        </span>
        {done && <span className="match__score">{match.outcome === 'kampflos' ? (match.winnerId === match.a.playerId ? '✓' : '–') : setsWonBy(match, 'a')}</span>}
      </div>
      <div className="match__vs">gegen</div>
      <div className="match__side">
        <span className={`match__name ${done && match.winnerId === match.b.playerId ? 'is-winner' : ''} ${match.b.playerId ? '' : 'is-placeholder'}`}>
          {bName}
        </span>
        {done && <span className="match__score">{match.outcome === 'kampflos' ? (match.winnerId === match.b.playerId ? '✓' : '–') : setsWonBy(match, 'b')}</span>}
      </div>

      {done && match.outcome === 'gespielt' && <p className="match__result">{formatScore(match)}</p>}

      {editing && (
        <form
          className="sets"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="sets__head" aria-hidden="true">
            <span>{aName}</span>
            <span>{bName}</span>
          </div>
          {values.map((row, i) => (
            <div className="set-row" key={`set-${i}`}>
              <span className="set-row__label">{total > 1 ? `Satz ${i + 1}` : 'Punkte'}</span>
              <input
                ref={i === 0 ? firstInput : undefined}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row[0]}
                aria-label={total > 1 ? `Punkte ${aName}, Satz ${i + 1}` : `Punkte ${aName}`}
                onChange={(e) => change(i, 0, e.target.value)}
              />
              <span className="set-row__colon" aria-hidden="true">:</span>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={row[1]}
                aria-label={total > 1 ? `Punkte ${bName}, Satz ${i + 1}` : `Punkte ${bName}`}
                onChange={(e) => change(i, 1, e.target.value)}
              />
            </div>
          ))}
          {errors.length > 0 && (
            <div className={`note ${pairChanged || pairWarning ? 'note--warn' : 'note--error'}`} role="alert">
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="match__actions">
            <button className="btn btn--primary" type="submit">
              Speichern
            </button>
            <button className="btn" type="button" onClick={() => setEditing(false)}>
              Abbrechen
            </button>
            {done && (
              <button
                className="btn btn--danger"
                type="button"
                onClick={() => {
                  if (confirm('Das eingetragene Ergebnis wirklich löschen?')) {
                    onClear();
                    setEditing(false);
                  }
                }}
              >
                Ergebnis löschen
              </button>
            )}
          </div>
        </form>
      )}

      {referee && ready && !done && !readOnly && (
        <RefereeView
          match={match}
          aName={aName}
          bName={bName}
          rules={rules}
          onSetDone={onLiveSets}
          onFinished={(sets) => {
            onSave(sets);
            setReferee(false);
          }}
          onClose={() => setReferee(false)}
        />
      )}

      {!editing && (
        <div className="match__actions">
          {!ready && <span className="muted">Wartet auf die Vorspiele.</span>}
          {ready && !readOnly && !done && (
            <button className="btn btn--primary" type="button" onClick={() => setReferee(true)}>
              🏸 Schiri-Modus
            </button>
          )}
          {ready && !readOnly && (
            <button className={`btn ${done ? 'btn--primary' : ''}`} type="button" onClick={open}>
              {done ? 'Ergebnis ändern' : 'Ergebnis eintragen'}
            </button>
          )}
          {ready && !readOnly && !done && (
            <>
              <button className="btn" type="button" onClick={() => onWalkover(match.a.playerId as Id)}>
                Sieg {aName} (kampflos)
              </button>
              <button className="btn" type="button" onClick={() => onWalkover(match.b.playerId as Id)}>
                Sieg {bName} (kampflos)
              </button>
            </>
          )}
          {ready && readOnly && (
            <span className="muted">Eintragen kann nur, wer Bearbeitungsrecht hat (Turnierleitung oder Schiri).</span>
          )}
        </div>
      )}
    </article>
  );
}
