import { useEffect, useRef, useState } from 'react';
import type { Match, ScoringRules, SetScore } from '../engine/types';

/** Merker des laufenden Satzes – überlebt das Neuladen der Live-Seite. */
export const REFEREE_KEY = 'stelzengaudi:referee';

interface Stored {
  matchId: string;
  pair: [string | null, string | null];
  a: number;
  b: number;
  history: ('a' | 'b')[];
}

function readStored(matchId: string, pair: [string | null, string | null]): Stored | null {
  try {
    const raw = sessionStorage.getItem(REFEREE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Stored;
    if (
      d.matchId !== matchId ||
      !Array.isArray(d.pair) ||
      d.pair[0] !== pair[0] ||
      d.pair[1] !== pair[1] ||
      !Number.isInteger(d.a) ||
      !Number.isInteger(d.b) ||
      !Array.isArray(d.history)
    ) {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

interface Props {
  match: Match;
  aName: string;
  bName: string;
  rules: ScoringRules;
  /** Ein Satz ist fertig – der Stand geht an alle Mitleser. */
  onSetDone: (sets: SetScore[]) => void;
  /** Das Spiel ist entschieden. */
  onFinished: (sets: SetScore[]) => void;
  onClose: () => void;
}

/**
 * Schiri-Modus: zwei große Zähl-Knöpfe, ein Rückgängig. Der laufende Satz
 * bleibt auf diesem Gerät; erst ein ABGESCHLOSSENER Satz wird an alle
 * übertragen – sonst würde jede Zuschauer-Ansicht bei jedem Ballwechsel
 * neu laden.
 */
export function RefereeView({ match, aName, bName, rules, onSetDone, onFinished, onClose }: Props) {
  // Die Paarung, für die gezählt wird: ändert eine Korrektur anderswo die
  // Besetzung, darf kein Punkt mehr der neuen Paarung zugeschrieben werden.
  const [pair] = useState<[string | null, string | null]>([match.a.playerId, match.b.playerId]);
  // Der laufende Satz überlebt das Neuladen (die Live-Seite lädt nach jeder
  // Übertragung neu) über einen Sitzungs-Merker.
  const [restored] = useState(() => readStored(match.id, [match.a.playerId, match.b.playerId]));
  const [a, setA] = useState(restored?.a ?? 0);
  const [b, setB] = useState(restored?.b ?? 0);
  // Punktverlauf des laufenden Satzes, für Rückgängig.
  const [history, setHistory] = useState<('a' | 'b')[]>(restored?.history ?? []);
  // Kurze Sperre nach dem Satzende, damit ein Doppeltipp keinen Geisterpunkt
  // in den nächsten Satz trägt.
  const [locked, setLocked] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Fertige Sätze kommen aus dem Turnierstand selbst – so zeigt der Dialog
  // nie einen Zwischenstand, den eine Korrektur längst verworfen hat.
  const done = match.liveSets;
  const pairChanged = pair[0] !== match.a.playerId || pair[1] !== match.b.playerId;

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // Jeden Punktstand sichern, damit ein Neuladen nichts verschluckt.
  useEffect(() => {
    try {
      const stored: Stored = { matchId: match.id, pair, a, b, history };
      sessionStorage.setItem(REFEREE_KEY, JSON.stringify(stored));
    } catch {
      /* dann eben nicht */
    }
  }, [match.id, pair, a, b, history]);

  const clearStored = (): void => {
    try {
      sessionStorage.removeItem(REFEREE_KEY);
    } catch {
      /* dann eben nicht */
    }
  };

  const close = (): void => {
    clearStored();
    onClose();
  };

  useEffect(() => {
    // Escape schließt; Tab bleibt im Dialog.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        clearStored();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables = rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const target = match.pointsPerSet;
  const cap = !rules.freeScoring && rules.cap >= target ? rules.cap : Infinity;

  const setsWon = (side: 'a' | 'b'): number =>
    done.filter((s) => (side === 'a' ? s.a > s.b : s.b > s.a)).length;

  const setOver = (na: number, nb: number): boolean => {
    if (rules.freeScoring) return false;
    const hi = Math.max(na, nb);
    const lo = Math.min(na, nb);
    if (hi < target) return false;
    if (!rules.winByTwo) return hi === target;
    if (hi === cap) return hi > lo;
    return hi - lo >= 2;
  };

  const finishSet = (na: number, nb: number): void => {
    const next = [...done, { a: na, b: nb }];
    setA(0);
    setB(0);
    setHistory([]);
    setLocked(true);
    setTimeout(() => setLocked(false), 600);
    const won = next.filter((s) => s.a > s.b).length;
    const lost = next.length - won;
    if (won >= match.setsToWin || lost >= match.setsToWin) {
      clearStored();
      onFinished(next);
    } else {
      onSetDone(next);
    }
  };

  const point = (side: 'a' | 'b'): void => {
    const na = side === 'a' ? a + 1 : a;
    const nb = side === 'b' ? b + 1 : b;
    if (setOver(na, nb)) {
      finishSet(na, nb);
      return;
    }
    setA(na);
    setB(nb);
    setHistory((h) => [...h, side]);
  };

  /**
   * Holt den letzten fertigen Satz zurück in die Zählung – für den Fall,
   * dass ein Tipp zu viel den Satz versehentlich beendet hat. Die Punkte
   * stehen wieder da und lassen sich mit „Punkt zurück" korrigieren.
   */
  const takeBackSet = (): void => {
    if (done.length === 0 || a !== 0 || b !== 0) return;
    const last = done[done.length - 1];
    onSetDone(done.slice(0, -1));
    setA(last.a);
    setB(last.b);
    // Die echte Punktreihenfolge ist nicht mehr bekannt – für „Punkt zurück"
    // reicht eine Folge, die zuerst die Punkte des Satzverlierers abbaut.
    const [first, second]: Array<'a' | 'b'> = last.a >= last.b ? ['a', 'b'] : ['b', 'a'];
    setHistory([
      ...Array.from({ length: first === 'a' ? last.a : last.b }, () => first),
      ...Array.from({ length: second === 'a' ? last.a : last.b }, () => second),
    ]);
  };

  const undoPoint = (): void => {
    const last = history[history.length - 1];
    if (!last) return;
    if (last === 'a') setA((v) => Math.max(0, v - 1));
    else setB((v) => Math.max(0, v - 1));
    setHistory((h) => h.slice(0, -1));
  };

  const setNumber = done.length + 1;
  const needsMore = match.setsToWin > 1;

  const setLabel = rules.freeScoring
    ? needsMore
      ? `Satz ${setNumber} · freie Zählung`
      : 'ein Satz · freie Zählung'
    : needsMore
      ? `Satz ${setNumber} bis ${target}`
      : `ein Satz bis ${target}`;

  return (
    <div
      className="referee"
      role="dialog"
      aria-modal="true"
      aria-label={`Schiri-Modus Spiel ${match.number}`}
      ref={rootRef}
    >
      <div className="referee__head">
        <span>
          Spiel {match.number} · {match.label} · {setLabel}
        </span>
        <button className="btn btn--small" type="button" onClick={close} ref={closeButton}>
          Schließen
        </button>
      </div>

      {pairChanged && (
        <div className="note note--warn" role="alert">
          Die Paarung dieses Spiels hat sich durch eine Korrektur geändert. Bitte schließen und
          neu öffnen – die gezählten Punkte gelten nicht mehr.
        </div>
      )}

      {/* Immer im Baum, damit die Ansage beim ersten Satzende funktioniert. */}
      <div className="referee__sets" aria-live="polite">
        {done.length > 0
          ? `Sätze ${setsWon('a')}:${setsWon('b')} (${done.map((s) => `${s.a}:${s.b}`).join(', ')})`
          : ''}
      </div>

      <div className="referee__courts">
        <button
          className="referee__pad"
          type="button"
          disabled={locked || pairChanged}
          onClick={() => point('a')}
        >
          <span className="referee__name">{aName}</span>
          <span className="referee__score">{a}</span>
          <span className="referee__plus" aria-hidden="true">
            +1
          </span>
        </button>
        <button
          className="referee__pad referee__pad--b"
          type="button"
          disabled={locked || pairChanged}
          onClick={() => point('b')}
        >
          <span className="referee__name">{bName}</span>
          <span className="referee__score">{b}</span>
          <span className="referee__plus" aria-hidden="true">
            +1
          </span>
        </button>
      </div>

      <div className="referee__actions">
        <button className="btn" type="button" onClick={undoPoint} disabled={history.length === 0}>
          ↩ Punkt zurück
        </button>
        {done.length > 0 && a === 0 && b === 0 && (
          <button className="btn" type="button" onClick={takeBackSet}>
            Satz {done.length} zurückholen ({done[done.length - 1].a}:{done[done.length - 1].b})
          </button>
        )}
        {rules.freeScoring && (
          <button className="btn btn--primary" type="button" disabled={a === b} onClick={() => finishSet(a, b)}>
            Satz beenden
          </button>
        )}
      </div>
      <p className="muted referee__hint">
        Die Punkte bleiben auf diesem Gerät – erst ein fertiger Satz geht an alle. „Satz
        zurückholen“ macht den letzten fertigen Satz wieder zum laufenden.
      </p>
    </div>
  );
}
