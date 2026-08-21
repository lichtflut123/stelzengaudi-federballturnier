import { useEffect, useMemo, useRef } from 'react';
import type { Half, Id, Match, Tournament, Tree } from '../engine/types';
import { formatScore, setsWonBy } from '../engine/scoring';
import { playerNames } from '../engine/schedule';
import { consolationWinner, podium } from '../engine/tournament';

interface Props {
  tournament: Tournament;
}

interface Column {
  key: string;
  title: string;
  matches: Match[];
  /** Innerste Spalte einer Hälfte – von hier geht es ins Finale. */
  isInner: boolean;
}

/**
 * Turnierbaum wie eine WM-Übersicht: linke Hälfte läuft nach rechts, rechte
 * Hälfte nach links, das Finale steht in der Mitte auf einer Achse mit den
 * Halbfinals.
 */
export function BracketView({ tournament }: Props) {
  const names = useMemo(() => playerNames(tournament.players), [tournament.players]);
  const matches = tournament.matches;
  const places = podium(tournament);
  const trostWinner = consolationWinner(tournament);
  const hasTrost = matches.some((m) => m.tree === 'trost');

  if (matches.length === 0) {
    return (
      <div className="empty">
        <p>Noch kein Turnierbaum.</p>
        <p className="muted">Erst unter „Vorbereitung“ auslosen.</p>
      </div>
    );
  }

  return (
    <>
      <TreeView
        tournament={tournament}
        names={names}
        tree="haupt"
        title="Hauptrunde"
        winnerId={places[0]?.playerId ?? null}
      />
      {hasTrost && (
        <TreeView
          tournament={tournament}
          names={names}
          tree="trost"
          title="Trostrunde – für alle, die ihr erstes Spiel verloren haben"
          winnerId={trostWinner}
        />
      )}
    </>
  );
}

function TreeView({
  tournament,
  names,
  tree,
  title,
  winnerId,
}: {
  tournament: Tournament;
  names: ReadonlyMap<Id, string>;
  tree: Tree;
  title: string;
  winnerId: Id | null;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const matches = tournament.matches.filter((m) => m.tree === tree);
  // Das Endspiel steht als einziges Spiel in der Mitte des Baums.
  const final = matches.find((m) => !m.isThirdPlace && m.half === 'mitte');
  const third = matches.find((m) => m.isThirdPlace);
  const left = columnsFor(matches, 'links');
  const right = columnsFor(matches, 'rechts').slice().reverse();

  // Beim Sichtbarwerden auf das Finale in der Mitte scrollen. Ein reiner
  // Mount-Effekt reicht nicht: der Bereich ist zunächst ausgeblendet.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const center = (): void => {
      if (el.clientWidth === 0) return;
      const target = Math.max(0, (el.scrollWidth - el.clientWidth) / 2);
      if (Math.abs(el.scrollLeft - target) > 4) el.scrollLeft = target;
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(el);
    return () => observer.disconnect();
  }, [matches.length]);

  if (matches.length === 0) return null;

  return (
    <section className="tree">
      <h2 className="tree__title">{title}</h2>
      <div className="bracket-scroll" ref={scroller} tabIndex={0} role="region" aria-label={title}>
        <div className="bracket">
          <div className="bracket__side">
            {left.map((col) => (
              <BracketColumn key={col.key} column={col} names={names} side="links" />
            ))}
          </div>

          <div className="bracket__center">
            <div className="bracket__col-title bracket__col-title--final">
              {final?.label ?? (tree === 'trost' ? 'Trostfinale' : 'Finale')}
            </div>
            <div className="bracket__center-body">
              {final ? (
                <MatchCardSmall match={final} names={names} variant="final" />
              ) : (
                <div className="bracket__match bracket__match--final">
                  <span className="bracket__name is-placeholder">noch offen</span>
                </div>
              )}
              {winnerId && (
                <div className="bracket__winner">
                  <span aria-hidden="true">🏆</span> {names.get(winnerId) ?? ''}
                </div>
              )}
            </div>
            {third && (
              <div className="bracket__third">
                <div className="bracket__col-title">Spiel um Platz 3</div>
                <MatchCardSmall match={third} names={names} />
              </div>
            )}
          </div>

          <div className="bracket__side bracket__side--right">
            {right.map((col) => (
              <BracketColumn key={col.key} column={col} names={names} side="rechts" />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function columnsFor(matches: readonly Match[], half: Half): Column[] {
  const inHalf = matches.filter((m) => m.half === half && !m.isThirdPlace);
  const rounds = [...new Set(inHalf.map((m) => m.round))].sort((a, b) => a - b);
  return rounds.map((round, index) => {
    const roundMatches = inHalf
      .filter((m) => m.round === round)
      .sort((a, b) => a.posInRound - b.posInRound);
    return {
      key: `${half}-${round}`,
      title: roundMatches[0]?.label ?? `Runde ${round}`,
      matches: roundMatches,
      isInner: index === rounds.length - 1,
    };
  });
}

function BracketColumn({
  column,
  names,
  side,
}: {
  column: Column;
  names: ReadonlyMap<Id, string>;
  side: 'links' | 'rechts';
}) {
  const isPlayIn = column.matches[0]?.phase === 'vorrunde';
  return (
    <div className={`bracket__col bracket__col--${side} ${isPlayIn ? 'bracket__col--playin' : ''}`}>
      <div className="bracket__col-title">{column.title}</div>
      <div className={`bracket__col-body ${column.isInner ? 'is-inner' : ''}`}>
        {column.matches.map((match) => (
          <div className="bracket__cell" key={match.id}>
            <MatchCardSmall match={match} names={names} />
          </div>
        ))}
      </div>
    </div>
  );
}

function nameFor(match: Match, side: 'a' | 'b', names: ReadonlyMap<Id, string>): string {
  const id = match[side].playerId;
  if (id) return names.get(id) ?? 'Unbekannt';
  return match[side].source || 'noch offen';
}

function MatchCardSmall({
  match,
  names,
  variant,
}: {
  match: Match;
  names: ReadonlyMap<Id, string>;
  variant?: 'final';
}) {
  const score = formatScore(match);
  return (
    <div
      className={`bracket__match ${variant === 'final' ? 'bracket__match--final' : ''} ${
        match.winnerId ? 'is-done' : ''
      }`}
    >
      {(['a', 'b'] as const).map((side) => {
        const isWinner = match.winnerId !== null && match.winnerId === match[side].playerId;
        const known = Boolean(match[side].playerId);
        return (
          <div key={side} className={`bracket__row ${isWinner ? 'is-winner' : ''} ${known ? '' : 'is-placeholder'}`}>
            <span className="bracket__name">{nameFor(match, side, names)}</span>
            <span className="bracket__sets">
              {match.outcome === 'gespielt' ? setsWonBy(match, side) : isWinner ? '✓' : ''}
            </span>
          </div>
        );
      })}
      <div className="bracket__foot">
        <span>Spiel {match.number}</span>
        {score && <span>{score}</span>}
      </div>
    </div>
  );
}
