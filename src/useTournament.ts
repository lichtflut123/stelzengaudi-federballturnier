import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Tournament } from './engine/types';
import { createTournament, recompute } from './engine/tournament';
import { loadTournament, saveTournament, storageState, type SaveResult } from './engine/storage';
import { isLivePage, readEmbeddedState } from './live';

const UNDO_LIMIT = 40;

interface State {
  current: Tournament;
  history: Tournament[];
  /** Zählt nur Schritte, die im Rückgängig-Stapel landen. */
  revision: number;
  /** Feld, dessen Eingabe gerade zu einem Schritt zusammengefasst wird. */
  group: string | null;
  /** Zählt JEDE inhaltliche Änderung – Grundlage fürs Veröffentlichen. */
  contentRevision: number;
}

type Action =
  | { type: 'set'; tournament: Tournament; group?: string }
  | { type: 'apply'; fn: (t: Tournament) => Tournament; group?: string }
  | { type: 'undo' }
  | { type: 'reset' }
  /**
   * Übernimmt einen fremden Stand aus dem gemeinsamen Speicher: ohne
   * Rückgängig-Schritt und ohne die Inhaltszählung zu erhöhen – sonst würde
   * jede Übernahme sofort wieder zurückgeschrieben.
   */
  | { type: 'adopt'; tournament: Tournament };

/**
 * Reiner Reducer: keine Seiteneffekte im Updater. Damit ist der
 * Rückgängig-Stapel auch dann korrekt, wenn React die Funktion im
 * Entwicklungsmodus absichtlich doppelt aufruft.
 */
function reducer(state: State, action: Action): State {
  // Eine Folge von Änderungen am selben Feld (Tippen) ergibt genau einen
  // Rückgängig-Schritt: der erste Tastendruck legt ihn an, die weiteren nicht.
  const push = (next: Tournament, group?: string): State => {
    const sameGroup = group !== undefined && group === state.group;
    return {
      current: next,
      history: sameGroup ? state.history : [...state.history.slice(-(UNDO_LIMIT - 1)), state.current],
      revision: sameGroup ? state.revision : state.revision + 1,
      contentRevision: state.contentRevision + 1,
      group: group ?? null,
    };
  };
  switch (action.type) {
    case 'set':
      return push(action.tournament, action.group);
    case 'apply':
      return push(action.fn(state.current), action.group);
    case 'undo': {
      if (state.history.length === 0) return state;
      return {
        current: state.history[state.history.length - 1],
        history: state.history.slice(0, -1),
        revision: state.revision + 1,
        contentRevision: state.contentRevision + 1,
        group: null,
      };
    }
    case 'reset':
      return push(createTournament());
    case 'adopt':
      return { ...state, current: action.tournament, group: null };
    default:
      return state;
  }
}

export interface TournamentStore {
  tournament: Tournament;
  /** Ersetzt den Stand. `group` fasst Tastendrücke zu einem Schritt zusammen. */
  update: (next: Tournament, group?: string) => void;
  /** Ändert den Stand über eine Funktion – immer auf dem aktuellen Stand. */
  apply: (fn: (current: Tournament) => Tournament, group?: string) => void;
  undo: () => void;
  /** Fremden Stand übernehmen (gemeinsamer Live-Speicher). */
  adoptRemote: (next: Tournament) => void;
  canUndo: boolean;
  reset: () => void;
  /** Erhöht sich bei jeder inhaltlichen Änderung – auch beim Umbenennen. */
  contentRevision: number;
  /** Tipp-Gruppe der letzten Änderung (null = abgeschlossene Aktion). */
  pendingGroup: string | null;
  /** true, wenn die Seite als geteilte Live-Seite läuft. */
  live: boolean;
  /** 'ok' | 'voll' | 'gesperrt' – Zustand der Speicherung. */
  saveState: SaveResult;
}

export function useTournament(): TournamentStore {
  const live = isLivePage();
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    // Auf der Live-Seite ist der eingebettete Stand die gemeinsame Wahrheit.
    // Geladene Stände einmal nachrechnen: gespeicherte Verknüpfungen können
    // veraltet oder von Hand verändert sein.
    current: recompute((live ? readEmbeddedState() : loadTournament()) ?? createTournament()),
    history: [] as Tournament[],
    revision: 0,
    contentRevision: 0,
    group: null,
  }));
  const [saveState, setSaveState] = useState<SaveResult>(() => (live ? 'ok' : storageState()));
  const lastSaved = useRef<Tournament | null>(null);

  useEffect(() => {
    // Wertvergleich statt Einmal-Flag: immun gegen doppelte Effektaufrufe.
    if (lastSaved.current === state.current) return;
    lastSaved.current = state.current;
    // Auf der Live-Seite hält die veröffentlichte Fassung den Stand.
    if (!live) setSaveState(saveTournament(state.current));
  }, [state.current, live]);

  const update = useCallback(
    (next: Tournament, group?: string) => dispatch({ type: 'set', tournament: next, group }),
    [],
  );
  const apply = useCallback(
    (fn: (t: Tournament) => Tournament, group?: string) => dispatch({ type: 'apply', fn, group }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const adoptRemote = useCallback(
    (next: Tournament) => dispatch({ type: 'adopt', tournament: next }),
    [],
  );
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return useMemo(
    () => ({
      tournament: state.current,
      update,
      apply,
      undo,
      adoptRemote,
      canUndo: state.history.length > 0,
      reset,
      saveState,
      contentRevision: state.contentRevision,
      pendingGroup: state.group,
      live,
    }),
    [
      state.current,
      state.history.length,
      state.contentRevision,
      state.group,
      update,
      apply,
      undo,
      reset,
      saveState,
      live,
    ],
  );
}
