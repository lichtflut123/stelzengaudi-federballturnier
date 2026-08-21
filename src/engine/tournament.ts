import type { Id, Match, Player, SetScore, Tournament, TournamentSettings } from './types';
import { createRng, randomSeed } from './rng';
import { newId } from './ids';
import { buildBracket, labelSources, mainBracketSize } from './bracket';
import { assignSlots, compareForPlan, renumber } from './schedule';
import { maxSets, resultWinnerSide, validateResult, validateSet } from './scoring';

export const SCHEMA_VERSION = 3;

/** Obergrenzen, damit weder Eingabe noch Import die App lahmlegen können. */
export const LIMITS = {
  players: 128,
  courts: 12,
  matches: 512,
  pointsPerSet: 99,
  cap: 99,
  nameLength: 40,
  songLength: 80,
  titleLength: 60,
} as const;

export function defaultSettings(): TournamentSettings {
  return {
    name: 'Stelzengaudi Federballturnier',
    // Ein Feld: so spielt die Stelzengaudi-Runde. Mehr Felder sind einstellbar.
    courts: 1,
    thirdPlaceMatch: true,
    consolation: true,
    scoring: {
      // Zwei Gewinnsätze bis 12, zwei Punkte Vorsprung, keine Obergrenze.
      // Ab dem Halbfinale gehen die Sätze bis 21; die Trostrunde spielt nur
      // einen Satz, damit der Abend reicht.
      setsToWin: 2,
      pointsPerSet: 12,
      endgamePointsPerSet: 21,
      winByTwo: true,
      cap: 0,
      consolationSetsToWin: 1,
      freeScoring: false,
    },
  };
}

export function createTournament(partial?: Partial<TournamentSettings>): Tournament {
  return {
    version: SCHEMA_VERSION,
    id: newId('t'),
    createdAt: new Date().toISOString(),
    settings: { ...defaultSettings(), ...partial },
    players: [],
    matches: [],
    drawSeed: null,
    drawnAt: null,
    drawWarnings: [],
  };
}

export function createPlayer(name: string, isChampion = false, song = ''): Player {
  return {
    id: newId('p'),
    name: name.trim().slice(0, LIMITS.nameLength),
    isChampion,
    song: song.trim().slice(0, LIMITS.songLength),
  };
}

export interface SetupCheck {
  errors: string[];
  warnings: string[];
  /** Vorschau auf den Umfang des Turniers. */
  preview: {
    mainSize: number;
    playInCount: number;
    consolationSize: number;
    totalMatches: number;
  } | null;
}

function isPositiveInt(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Anzahl der Plätze in der Trostrunde: alle Verlierer der ersten Spiele. */
export function consolationSize(playerCount: number): number {
  if (playerCount < 2) return 0;
  const mainSize = mainBracketSize(playerCount);
  return playerCount - mainSize + mainSize / 2;
}

/** Wie viele Spiele das Turnier bei dieser Teilnehmerzahl hat. */
export function matchCount(playerCount: number, thirdPlaceMatch: boolean, consolation: boolean): number {
  if (playerCount < 2) return 0;
  // K.-o.: jedes Spiel scheidet genau eine Person aus.
  const mainSize = mainBracketSize(playerCount);
  let total = playerCount - 1;
  if (thirdPlaceMatch && mainSize >= 4) total += 1;
  if (consolation) {
    const size = consolationSize(playerCount);
    if (size >= 2) total += size - 1;
  }
  return total;
}

/** Prüft, ob mit den aktuellen Einstellungen ausgelost werden kann. */
export function checkSetup(t: Tournament): SetupCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const s = t.settings;

  if (t.players.some((p) => p.name.trim() === '')) errors.push('Es gibt Personen ohne Namen.');
  const names = t.players.map((p) => p.name.trim().toLowerCase()).filter(Boolean);
  const duplicates = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
  if (duplicates.length > 0) {
    warnings.push(`Doppelte Namen: ${duplicates.join(', ')}. Im Spielplan sind die nicht zu unterscheiden.`);
  }
  if (t.players.length < 2) {
    errors.push('Es werden mindestens zwei Personen gebraucht.');
  }
  if (t.players.length > LIMITS.players) {
    errors.push(`Mehr als ${LIMITS.players} Personen sind nicht vorgesehen.`);
  }

  if (!isPositiveInt(s.courts, 1, LIMITS.courts)) {
    errors.push(`Die Anzahl der Felder muss zwischen 1 und ${LIMITS.courts} liegen.`);
  }
  if (!isPositiveInt(s.scoring.pointsPerSet, 1, LIMITS.pointsPerSet) && !s.scoring.freeScoring) {
    errors.push(`Die Punkte pro Satz müssen zwischen 1 und ${LIMITS.pointsPerSet} liegen.`);
  }
  if (!isPositiveInt(s.scoring.endgamePointsPerSet, 1, LIMITS.pointsPerSet) && !s.scoring.freeScoring) {
    errors.push(`Die Punkte ab dem Halbfinale müssen zwischen 1 und ${LIMITS.pointsPerSet} liegen.`);
  }
  if (!isPositiveInt(s.scoring.cap, 0, LIMITS.cap)) {
    errors.push(`Die Obergrenze muss zwischen 0 und ${LIMITS.cap} liegen.`);
  }
  if (
    !s.scoring.freeScoring &&
    s.scoring.winByTwo &&
    s.scoring.cap > 0 &&
    s.scoring.cap < Math.max(s.scoring.pointsPerSet, s.scoring.endgamePointsPerSet)
  ) {
    warnings.push('Die Obergrenze ist kleiner als die Punkte pro Satz und bleibt deshalb wirkungslos.');
  }

  const ohneMusik = t.players.filter((p) => p.name.trim() !== '' && p.song.trim() === '');
  if (ohneMusik.length > 0 && t.players.length >= 2) {
    const namen = ohneMusik.slice(0, 6).map((p) => p.name.trim());
    warnings.push(
      `Noch ohne Einlaufmusik: ${namen.join(', ')}${ohneMusik.length > 6 ? ' und weitere' : ''}.`,
    );
  }

  const champions = t.players.filter((p) => p.isChampion).length;
  if (champions === 0 && t.players.length >= 2) {
    warnings.push('Kein Vorjahresgewinner markiert – dann ist die Auslosung rein zufällig.');
  }

  let preview: SetupCheck['preview'] = null;
  if (t.players.length >= 2 && errors.length === 0) {
    const mainSize = mainBracketSize(t.players.length);
    const playInCount = t.players.length - mainSize;
    preview = {
      mainSize,
      playInCount,
      consolationSize: s.consolation ? consolationSize(t.players.length) : 0,
      totalMatches: matchCount(t.players.length, s.thirdPlaceMatch, s.consolation),
    };
    if (mainSize >= 4 ? champions > mainSize / 2 : champions > mainSize) {
      warnings.push(
        `Bei ${champions} Vorjahresgewinnern und einem Hauptfeld für ${mainSize} lässt sich ein frühes Duell nicht vermeiden.`,
      );
    }
    if (champions > mainSize - playInCount) {
      warnings.push('Es sind so viele Vorjahresgewinner, dass einige in die Vorrunde müssen.');
    }
    if (champions > 4 && mainSize >= 16) {
      warnings.push(
        'Ab fünf Vorjahresgewinnern kann sich ein Duell schon im Viertelfinale ergeben – die erste Runde bleibt frei davon.',
      );
    }
  }

  return { errors, warnings, preview };
}

/** Führt die Auslosung durch und liefert ein neues Turnier. */
export function performDraw(t: Tournament, seed: number = randomSeed()): Tournament {
  const rng = createRng(seed);
  const plan = buildBracket(t.players, rng, {
    thirdPlaceMatch: t.settings.thirdPlaceMatch,
    consolation: t.settings.consolation,
    scoring: t.settings.scoring,
  });
  const matches = plan.matches;

  assignSlots(matches, t.settings.courts);
  renumber(matches);
  labelSources(matches);
  matches.sort(compareForPlan);

  return recompute({
    ...t,
    matches,
    drawSeed: seed,
    drawnAt: new Date().toISOString(),
    drawWarnings: plan.warnings,
  });
}

function clearMatchResult(match: Match): void {
  match.sets = [];
  match.liveSets = [];
  match.liveFor = null;
  match.outcome = 'offen';
  match.winnerId = null;
  match.resultFor = null;
}

function samePairing(match: Match): boolean {
  if (!match.resultFor) return false;
  return match.resultFor[0] === match.a.playerId && match.resultFor[1] === match.b.playerId;
}

/**
 * Bringt den Baum mit den vorliegenden Ergebnissen in Einklang: Sieger rücken
 * auf, und jedes Ergebnis, dessen Paarung sich geändert hat, wird gelöscht.
 * Das ist der Kern der Korrigierbarkeit – ohne diese Bindung würde ein
 * eingetragenes Ergebnis nach einer Korrektur der falschen Person zugeschrieben.
 */
export function recompute(t: Tournament): Tournament {
  const matches = t.matches.map((m) => ({
    ...m,
    a: { ...m.a },
    b: { ...m.b },
    sets: m.sets.map((s) => ({ ...s })),
    liveSets: Array.isArray(m.liveSets) ? m.liveSets.map((s) => ({ ...s })) : [],
    liveFor: m.liveFor ? ([m.liveFor[0], m.liveFor[1]] as [Id | null, Id | null]) : null,
    resultFor: m.resultFor ? ([m.resultFor[0], m.resultFor[1]] as [Id | null, Id | null]) : null,
  }));
  const byId = new Map(matches.map((m) => [m.id, m]));

  // Alle Plätze leeren, die sich aus Vorspielen ergeben.
  const fedSlots = new Set<string>();
  for (const match of matches) {
    if (match.nextMatchId && match.nextSlot) fedSlots.add(`${match.nextMatchId}:${match.nextSlot}`);
    if (match.loserNextMatchId && match.loserNextSlot) {
      fedSlots.add(`${match.loserNextMatchId}:${match.loserNextSlot}`);
    }
  }
  for (const match of matches) {
    for (const side of ['a', 'b'] as const) {
      if (fedSlots.has(`${match.id}:${side}`)) match[side].playerId = null;
    }
    if (match.isThirdPlace) {
      match.a.playerId = null;
      match.b.playerId = null;
    }
  }

  // Tatsächlich vorhandene Runden in Reihenfolge abarbeiten (keine Annahme
  // über den Zahlenbereich – manipulierte Daten dürfen nicht bremsen).
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const decide = (match: Match): void => {
    const a = match.a.playerId;
    const b = match.b.playerId;
    const participants = [a, b].filter((x): x is Id => Boolean(x));
    // Wirklich offen: kein Ergebnis und kein Sieger. Ein angezählter
    // Zwischenstand verfällt, sobald sich die Paarung ändert, für die der
    // Schiri gezählt hat.
    if (match.outcome === 'offen' && !match.winnerId) {
      const liveValid =
        participants.length === 2 &&
        a !== b &&
        match.liveFor !== null &&
        match.liveFor[0] === a &&
        match.liveFor[1] === b;
      if (match.liveSets.length > 0 && !liveValid) {
        match.liveSets = [];
      }
      if (match.liveSets.length === 0) match.liveFor = null;
      return;
    }
    const valid =
      match.outcome !== 'offen' &&
      participants.length === 2 &&
      a !== b &&
      samePairing(match) &&
      match.winnerId !== null &&
      participants.includes(match.winnerId);
    if (!valid) clearMatchResult(match);
  };

  const loserOf = (match: Match): Id | null => {
    if (!match.winnerId) return null;
    return match.a.playerId === match.winnerId ? match.b.playerId : match.a.playerId;
  };

  for (const round of rounds) {
    for (const match of matches.filter((m) => m.round === round && !m.isThirdPlace)) {
      decide(match);
      if (!match.winnerId) continue;
      if (match.nextMatchId && match.nextSlot) {
        const target = byId.get(match.nextMatchId);
        if (target) target[match.nextSlot].playerId = match.winnerId;
      }
      // Verlierer in die Trostrunde schicken.
      if (match.loserNextMatchId && match.loserNextSlot) {
        const target = byId.get(match.loserNextMatchId);
        if (target) target[match.loserNextSlot].playerId = loserOf(match);
      }
    }
  }

  // Spiel um Platz 3 aus den Halbfinal-Verlierern befüllen.
  const third = matches.find((m) => m.isThirdPlace);
  if (third) {
    const semis = matches
      .filter((m) => !m.isThirdPlace && m.label === 'Halbfinale')
      .sort((a, b) => a.posInRound - b.posInRound);
    semis.slice(0, 2).forEach((semi, i) => {
      const side = i === 0 ? 'a' : 'b';
      if (!semi.winnerId) return;
      const loser = semi.a.playerId === semi.winnerId ? semi.b.playerId : semi.a.playerId;
      third[side].playerId = loser;
    });
    decide(third);
  }

  return { ...t, matches };
}

/** Trägt ein Satzergebnis ein. Wirft bei ungültigem Ergebnis. */
export function setResult(t: Tournament, matchId: Id, sets: readonly SetScore[]): Tournament {
  const target = t.matches.find((m) => m.id === matchId);
  if (!target) throw new Error('Dieses Spiel gibt es nicht.');
  if (!target.a.playerId || !target.b.playerId) {
    throw new Error('Für dieses Spiel stehen noch nicht beide Personen fest.');
  }
  const rules = { ...t.settings.scoring, setsToWin: target.setsToWin };
  const check = validateResult(sets, rules, target.pointsPerSet);
  if (!check.ok) throw new Error(check.errors.join(' '));
  const side = resultWinnerSide(sets, rules);
  if (!side) throw new Error('Das Ergebnis hat keinen Sieger.');

  const winnerId = side === 'a' ? target.a.playerId : target.b.playerId;
  const matches = t.matches.map((m) =>
    m.id === matchId
      ? {
          ...m,
          sets: sets.map((s) => ({ ...s })),
          liveSets: [],
          liveFor: null,
          outcome: 'gespielt' as const,
          winnerId,
          resultFor: [m.a.playerId, m.b.playerId] as [Id | null, Id | null],
        }
      : m,
  );
  return recompute({ ...t, matches });
}

/**
 * Schiri-Modus: hält die abgeschlossenen Sätze eines LAUFENDEN Spiels fest.
 * Sobald damit ein Sieger feststeht, wird das Spiel regulär gewertet.
 * Wirft bei ungültigen Sätzen.
 */
export function setLiveSets(t: Tournament, matchId: Id, sets: readonly SetScore[]): Tournament {
  const target = t.matches.find((m) => m.id === matchId);
  if (!target) throw new Error('Dieses Spiel gibt es nicht.');
  if (!target.a.playerId || !target.b.playerId) {
    throw new Error('Für dieses Spiel stehen noch nicht beide Personen fest.');
  }
  if (target.winnerId) throw new Error('Dieses Spiel ist schon gewertet.');

  const rules = { ...t.settings.scoring, setsToWin: target.setsToWin };
  if (sets.length > maxSets(rules)) {
    throw new Error(
      maxSets(rules) === 1 ? 'Es ist nur ein Satz möglich.' : `Es sind höchstens ${maxSets(rules)} Sätze möglich.`,
    );
  }
  const trimmed = sets.slice(0, maxSets(rules));
  for (const set of trimmed) {
    const check = validateSet(set, rules, target.pointsPerSet);
    if (!check.ok) throw new Error(check.errors.join(' '));
  }
  // Entscheidet der letzte Satz das Spiel, wird regulär gewertet.
  if (resultWinnerSide(trimmed, rules)) return setResult(t, matchId, trimmed);

  const matches = t.matches.map((m) =>
    m.id === matchId
      ? {
          ...m,
          liveSets: trimmed.map((s) => ({ ...s })),
          liveFor: [m.a.playerId, m.b.playerId] as [Id | null, Id | null],
        }
      : m,
  );
  return recompute({ ...t, matches });
}

/** Wertet ein Spiel kampflos für eine Person. */
export function setWalkover(t: Tournament, matchId: Id, winnerId: Id): Tournament {
  const target = t.matches.find((m) => m.id === matchId);
  if (!target) throw new Error('Dieses Spiel gibt es nicht.');
  if (!target.a.playerId || !target.b.playerId) {
    throw new Error('Für dieses Spiel stehen noch nicht beide Personen fest.');
  }
  if (target.a.playerId !== winnerId && target.b.playerId !== winnerId) {
    throw new Error('Diese Person spielt in diesem Spiel nicht mit.');
  }
  const matches = t.matches.map((m) =>
    m.id === matchId
      ? {
          ...m,
          sets: [],
          liveSets: [],
          liveFor: null,
          outcome: 'kampflos' as const,
          winnerId,
          resultFor: [m.a.playerId, m.b.playerId] as [Id | null, Id | null],
        }
      : m,
  );
  return recompute({ ...t, matches });
}

/** Löscht ein Ergebnis wieder. */
export function clearResult(t: Tournament, matchId: Id): Tournament {
  const matches = t.matches.map((m) =>
    m.id === matchId
      ? {
          ...m,
          sets: [],
          liveSets: [],
          liveFor: null,
          outcome: 'offen' as const,
          winnerId: null,
          resultFor: null,
        }
      : m,
  );
  return recompute({ ...t, matches });
}

export interface PodiumEntry {
  place: number;
  playerId: Id;
}

function finalMatch(t: Tournament): Match | undefined {
  return t.matches.find((m) => m.tree === 'haupt' && m.label === 'Finale' && !m.isThirdPlace);
}

/** Sieger der Trostrunde, falls sie gespielt wurde. */
export function consolationWinner(t: Tournament): Id | null {
  return t.matches.find((m) => m.tree === 'trost' && m.label === 'Trostfinale')?.winnerId ?? null;
}

/** Endstand – erst, wenn das Finale entschieden ist. */
export function podium(t: Tournament): PodiumEntry[] {
  const final = finalMatch(t);
  if (!final?.winnerId) return [];
  const runnerUp = final.a.playerId === final.winnerId ? final.b.playerId : final.a.playerId;
  const result: PodiumEntry[] = [{ place: 1, playerId: final.winnerId }];
  if (runnerUp && runnerUp !== final.winnerId) result.push({ place: 2, playerId: runnerUp });
  const third = t.matches.find((m) => m.isThirdPlace);
  if (third?.winnerId && !result.some((p) => p.playerId === third.winnerId)) {
    result.push({ place: 3, playerId: third.winnerId });
  }
  return result;
}

/** Ist das Turnier komplett durchgespielt? */
export function isFinished(t: Tournament): boolean {
  return t.matches.length > 0 && t.matches.every((m) => m.winnerId !== null);
}

/** Fortschritt in Prozent (0–100). */
export function progress(t: Tournament): { played: number; total: number; percent: number } {
  const total = t.matches.length;
  const played = t.matches.filter((m) => m.winnerId !== null).length;
  return { played, total, percent: total === 0 ? 0 : Math.round((played / total) * 100) };
}

/** In welcher Runde jemand ausgeschieden ist – für die Teilnehmerliste. */
export function eliminatedIn(t: Tournament, playerId: Id): string | null {
  const losses = t.matches.filter(
    (m) => m.winnerId && m.winnerId !== playerId && (m.a.playerId === playerId || m.b.playerId === playerId),
  );
  if (losses.length === 0) return null;
  // Die letzte Niederlage zählt: erst danach ist jemand endgültig raus.
  const last = losses.reduce((best, m) => (m.round > best.round ? m : best), losses[0]);
  return last.label;
}

/**
 * In welchem Teil des Turniers eine Person noch im Rennen ist – oder null,
 * wenn sie in keinem offenen Spiel mehr steht.
 */
export function stillPlayingIn(t: Tournament, playerId: Id): string | null {
  const open = t.matches
    .filter((m) => m.winnerId === null && (m.a.playerId === playerId || m.b.playerId === playerId))
    .sort((x, y) => x.slot - y.slot);
  if (open.length === 0) return null;
  return open[0].tree === 'trost' ? 'Trostrunde' : open[0].label;
}

/**
 * Neues Turnier mit denselben Personen; die Sieger des alten Turniers sind
 * automatisch die Vorjahresgewinner des neuen.
 */
export function nextYear(t: Tournament): Tournament {
  const champions = new Set(podium(t).filter((p) => p.place === 1).map((p) => p.playerId));
  return {
    ...createTournament({ ...t.settings, scoring: { ...t.settings.scoring } }),
    players: t.players.map((p) => ({ ...p, id: newId('p'), isChampion: champions.has(p.id) })),
  };
}

