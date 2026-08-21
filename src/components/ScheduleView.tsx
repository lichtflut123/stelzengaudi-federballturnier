import { useEffect, useMemo, useRef, useState } from 'react';
import type { Id, Match, SetScore, Tournament } from '../engine/types';
import { MatchCard } from './MatchCard';
import { clearResult, setLiveSets, setResult, setWalkover } from '../engine/tournament';
import { compareForPlan, playerNames } from '../engine/schedule';

interface Props {
  tournament: Tournament;
  readOnly: boolean;
  apply: (fn: (current: Tournament) => Tournament) => void;
}

type Filter = 'alle' | 'offen' | 'fertig';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'alle', label: 'Alle Spiele' },
  { id: 'offen', label: 'Noch offen' },
  { id: 'fertig', label: 'Gespielt' },
];

export function ScheduleView({ tournament, readOnly, apply }: Props) {
  const [filter, setFilter] = useState<Filter>('alle');
  const [error, setError] = useState<string | null>(null);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const names = useMemo(() => playerNames(tournament.players), [tournament.players]);
  const previous = useRef(tournament);
  const lastAction = useRef<Id | null>(null);

  // Eine Korrektur kann Folge-Ergebnisse zurücksetzen – das passiert sonst
  // völlig stumm, und am lauten Turnierabend merkt es niemand.
  useEffect(() => {
    const before = previous.current;
    previous.current = tournament;
    if (before === tournament) return;
    const wasDecided = new Map(before.matches.map((m) => [m.id, m.winnerId !== null]));
    const resets = tournament.matches.filter(
      (m) => m.winnerId === null && wasDecided.get(m.id) === true && m.id !== lastAction.current,
    );
    if (resets.length === 0) return;
    const nummern = resets
      .map((m) => m.number)
      .sort((a, b) => a - b)
      .map((n) => `Spiel ${n}`)
      .join(', ');
    setResetNote(
      `Durch die Korrektur ${resets.length === 1 ? 'wurde ein späteres Ergebnis' : `wurden ${resets.length} spätere Ergebnisse`} zurückgesetzt (${nummern}) – bitte neu eintragen.`,
    );
  }, [tournament]);

  const visible = tournament.matches.filter((m) => {
    if (filter === 'offen') return m.winnerId === null;
    if (filter === 'fertig') return m.winnerId !== null;
    return true;
  });
  const blocks = groupByRound(visible);

  const guard = (matchId: Id, fn: () => void): void => {
    try {
      setError(null);
      setResetNote(null);
      lastAction.current = matchId;
      fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unbekannter Fehler.');
    }
  };

  if (tournament.matches.length === 0) {
    return (
      <div className="empty">
        <p>Noch kein Spielplan vorhanden.</p>
        <p className="muted">Erst unter „Vorbereitung“ die Namen eintragen und auslosen.</p>
      </div>
    );
  }

  return (
    <>
      <div className="filters no-print">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn--small ${filter === f.id ? 'btn--primary' : ''}`}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="note note--error" role="alert">
          {error}
        </div>
      )}

      {resetNote && (
        <div className="note note--warn" role="alert">
          {resetNote}{' '}
          <button className="btn btn--small" type="button" onClick={() => setResetNote(null)}>
            Verstanden
          </button>
        </div>
      )}

      {blocks.length === 0 && <p className="empty">Keine Spiele in dieser Auswahl.</p>}

      {blocks.map((block) => (
        <section key={block.key}>
          <div className="round-head">
            <h3>{block.title}</h3>
            <span className="muted">
              {block.matches.filter((m) => m.winnerId !== null).length} von {block.matches.length} gespielt
            </span>
          </div>
          {block.matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              names={names}
              rules={tournament.settings.scoring}
              readOnly={readOnly}
              onSave={(sets: SetScore[]) => guard(match.id, () => apply((t) => setResult(t, match.id, sets)))}
              onLiveSets={(sets: SetScore[]) =>
                guard(match.id, () => apply((t) => setLiveSets(t, match.id, sets)))
              }
              onWalkover={(winnerId: Id) =>
                guard(match.id, () => apply((t) => setWalkover(t, match.id, winnerId)))
              }
              onClear={() => guard(match.id, () => apply((t) => clearResult(t, match.id)))}
            />
          ))}
        </section>
      ))}
    </>
  );
}

interface Block {
  key: string;
  title: string;
  matches: Match[];
}

function groupByRound(matches: readonly Match[]): Block[] {
  const blocks = new Map<string, Block>();
  for (const match of matches) {
    // Haupt- und Trostrunde laufen zeitlich verschränkt, gehören aber nicht
    // unter dieselbe Überschrift – sonst stünde „Trost-Vorrunde" unter
    // „Viertelfinale".
    // Auch das Label gehört in den Schlüssel: Trost-Vorrunde und
    // Trost-Viertelfinale können in derselben Zeit-Runde liegen.
    const key = `${match.tree}-${match.round}-${match.label}-${match.isThirdPlace ? 'p3' : 'r'}`;
    const block = blocks.get(key) ?? { key, title: match.label, matches: [] };
    block.matches.push(match);
    blocks.set(key, block);
  }
  return [...blocks.values()]
    .map((block) => ({ ...block, matches: block.matches.slice().sort(compareForPlan) }))
    .sort((a, b) => compareForPlan(a.matches[0], b.matches[0]));
}
