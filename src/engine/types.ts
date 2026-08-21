/** Datentypen der Stelzengaudi-Federballturnier-App. */

export type Id = string;

/** Eine Person, die mitspielt. */
export interface Player {
  id: Id;
  name: string;
  /** Vorjahresgewinner – wird bei der Auslosung gesetzt und getrennt. */
  isChampion: boolean;
  /** Einlaufmusik – wird beim Aufruf des Spiels angezeigt. */
  song: string;
}

/** Zählweise für einen Satz. */
export interface ScoringRules {
  /** Sätze, die zum Sieg nötig sind (1 = ein Gewinnsatz, 2 = Best-of-3). */
  setsToWin: 1 | 2;
  /** Punkte, die ein Satz regulär braucht (z.B. 12 oder 21). */
  pointsPerSet: number;
  /** Punkte pro Satz ab dem Halbfinale des Hauptbaums. */
  endgamePointsPerSet: number;
  /** Zwei Punkte Vorsprung nötig? */
  winByTwo: boolean;
  /** Obergrenze bei Verlängerung (z.B. 30). 0 = keine Obergrenze. */
  cap: number;
  /** Sätze zum Sieg in der Trostrunde (kürzer, damit der Abend reicht). */
  consolationSetsToWin: 1 | 2;
  /** Wenn true, werden Satzergebnisse nicht gegen die Regeln geprüft. */
  freeScoring: boolean;
}

export interface TournamentSettings {
  name: string;
  /** Anzahl paralleler Felder. */
  courts: number;
  /** Spiel um Platz 3 austragen? */
  thirdPlaceMatch: boolean;
  /**
   * Trostrunde: Wer sein erstes Spiel verliert, spielt in einem zweiten Baum
   * weiter. So hat jede Person mindestens zwei Spiele.
   */
  consolation: boolean;
  scoring: ScoringRules;
}

/** Vorrunde = Qualifikation der Überzähligen, Hauptrunde = der eigentliche Baum. */
export type Phase = 'vorrunde' | 'hauptrunde';

/**
 * Welcher Baum: der Hauptbaum oder die Trostrunde, in der alle antreten,
 * die ihr erstes Spiel verloren haben.
 */
export type Tree = 'haupt' | 'trost';

/** Für die Baum-Darstellung: linke Hälfte, rechte Hälfte oder Mitte (Finale). */
export type Half = 'links' | 'rechts' | 'mitte';

export interface SetScore {
  a: number;
  b: number;
}

export type MatchOutcome = 'offen' | 'gespielt' | 'kampflos';

/** Ein Platz in einem Spiel. */
export interface Slot {
  playerId: Id | null;
  /** Woher der Teilnehmer kommt, z.B. "Sieger Spiel 3" oder "gesetzt". */
  source: string;
  /** Setzrang im Hauptbaum (nur erste Hauptrunde), sonst null. */
  rank: number | null;
}

export interface Match {
  id: Id;
  /** Laufende Nummer über das ganze Turnier, 1-basiert. */
  number: number;
  phase: Phase;
  tree: Tree;
  /** Punkte pro Satz in genau diesem Spiel (ab Halbfinale mehr). */
  pointsPerSet: number;
  /** Sätze zum Sieg in genau diesem Spiel (Trostrunde kürzer). */
  setsToWin: 1 | 2;
  /** Runde innerhalb des Turniers, 1-basiert (Vorrunde ist Runde 1). */
  round: number;
  /** Anzeigename der Runde, z.B. "Halbfinale". */
  label: string;
  half: Half;
  /** Position innerhalb der Runde, 0-basiert – bestimmt die Höhe im Baum. */
  posInRound: number;
  /** Zeitfenster im Spielplan, 1-basiert. */
  slot: number;
  /** Feld-Nummer, 1-basiert. */
  court: number;
  a: Slot;
  b: Slot;
  sets: SetScore[];
  /**
   * Abgeschlossene Sätze eines LAUFENDEN Spiels (Schiri-Modus). Wandert bei
   * jedem Satzende an alle Mitleser; das fertige Ergebnis steht in `sets`.
   */
  liveSets: SetScore[];
  /** Die Paarung, für die der Schiri zählt – analog zu `resultFor`. */
  liveFor: [Id | null, Id | null] | null;
  outcome: MatchOutcome;
  winnerId: Id | null;
  /**
   * Die Paarung, für die das Ergebnis eingetragen wurde. Ändert sich die
   * Besetzung des Spiels, wird das Ergebnis dadurch ungültig und gelöscht.
   */
  resultFor: [Id | null, Id | null] | null;
  /** Spiel, in das der Sieger einzieht. */
  nextMatchId: Id | null;
  nextSlot: 'a' | 'b' | null;
  /** Spiel, in das der Verlierer einzieht (Trostrunde). */
  loserNextMatchId: Id | null;
  loserNextSlot: 'a' | 'b' | null;
  isThirdPlace: boolean;
}

export interface Tournament {
  /** Schema-Version für Migrationen. */
  version: number;
  id: Id;
  createdAt: string;
  settings: TournamentSettings;
  players: Player[];
  matches: Match[];
  /** Losnummer der letzten Auslosung (macht sie nachvollziehbar). */
  drawSeed: number | null;
  drawnAt: string | null;
  /** Hinweise aus der Auslosung. */
  drawWarnings: string[];
}
