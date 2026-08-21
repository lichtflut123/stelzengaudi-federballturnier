import type { Half, Id, Match, Player, ScoringRules, Slot, Tree } from './types';
import type { Rng } from './rng';
import { newId } from './ids';

/** Größte Zweierpotenz ≤ n (mindestens 2). */
export function mainBracketSize(n: number): number {
  if (!Number.isFinite(n) || n < 2) return 2;
  let size = 2;
  while (size * 2 <= n) size *= 2;
  return size;
}

/**
 * Klassische Setzpositionen: Rückgabe[slot] = Setzrang auf diesem Platz.
 * Damit treffen die Gesetzten so spät wie möglich aufeinander.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    const next: number[] = [];
    for (const rank of order) next.push(rank, n + 1 - rank);
    order = next;
  }
  return order;
}

export function roundLabel(remaining: number, tree: Tree): string {
  if (tree === 'trost') {
    switch (remaining) {
      case 2:
        return 'Trostfinale';
      case 4:
        return 'Trost-Halbfinale';
      case 8:
        return 'Trost-Viertelfinale';
      default:
        return `Trostrunde der letzten ${remaining}`;
    }
  }
  switch (remaining) {
    case 2:
      return 'Finale';
    case 4:
      return 'Halbfinale';
    case 8:
      return 'Viertelfinale';
    case 16:
      return 'Achtelfinale';
    case 32:
      return 'Sechzehntelfinale';
    default:
      return `Runde der letzten ${remaining}`;
  }
}

/** Ab dem Halbfinale des Hauptbaums wird auf die höhere Punktzahl gespielt. */
export function isEndgame(label: string, tree: Tree): boolean {
  return tree === 'haupt' && (label === 'Halbfinale' || label === 'Finale' || label === 'Spiel um Platz 3');
}

function slot(playerId: Id | null, source: string, rank: number | null = null): Slot {
  return { playerId, source, rank };
}

interface SkeletonOptions {
  tree: Tree;
  entryCount: number;
  thirdPlaceMatch: boolean;
  scoring: ScoringRules;
}

interface Skeleton {
  matches: Match[];
  /** Spiele der ersten Runde (Vorrunde bzw. erste Hauptrunde). */
  firstMatches: Match[];
  /** Zugang zum Baum: Rang (1-basiert) -> {match, side}. */
  entries: Map<number, { match: Match; side: 'a' | 'b' }>;
  mainSize: number;
  playInCount: number;
  directCount: number;
}

function newMatch(
  partial: Partial<Match> &
    Pick<Match, 'phase' | 'tree' | 'label' | 'half' | 'posInRound' | 'pointsPerSet' | 'setsToWin'>,
): Match {
  return {
    id: newId('m'),
    number: 0,
    round: 1,
    slot: 1,
    court: 1,
    a: slot(null, ''),
    b: slot(null, ''),
    sets: [],
    liveSets: [],
    liveFor: null,
    outcome: 'offen',
    winnerId: null,
    resultFor: null,
    nextMatchId: null,
    nextSlot: null,
    loserNextMatchId: null,
    loserNextSlot: null,
    isThirdPlace: false,
    ...partial,
  } as Match;
}

/**
 * Baut ein leeres K.-o.-Gerüst für `entryCount` Teilnehmer, inklusive
 * Vorrunde, falls die Zahl keine Zweierpotenz ist. Die Zugänge werden über
 * Setzränge angesprochen: Rang 1 ist der stärkste Platz.
 */
function buildSkeleton(options: SkeletonOptions): Skeleton {
  const { tree, entryCount, scoring } = options;
  const mainSize = mainBracketSize(entryCount);
  const playInCount = Math.max(0, entryCount - mainSize);
  const directCount = mainSize - playInCount;
  const order = seedOrder(mainSize);
  const slotOfRank = new Map<number, number>();
  order.forEach((rank, index) => slotOfRank.set(rank, index));
  const halfOfRank = (rank: number): Half =>
    mainSize === 2 ? 'mitte' : (slotOfRank.get(rank) ?? 0) < mainSize / 2 ? 'links' : 'rechts';

  const matches: Match[] = [];
  const entries = new Map<number, { match: Match; side: 'a' | 'b' }>();

  // --- Hauptrunden -------------------------------------------------------
  const roundCount = Math.log2(mainSize);
  const playInOffset = entryCount > mainSize ? 1 : 0;
  const roundMatchesByRound: Match[][] = [];
  let previous: Match[] = [];
  for (let r = 1; r <= roundCount; r++) {
    const remaining = mainSize / Math.pow(2, r - 1);
    const label = roundLabel(remaining, tree);
    const points = isEndgame(label, tree) ? scoring.endgamePointsPerSet : scoring.pointsPerSet;
    const sets = tree === 'trost' ? scoring.consolationSetsToWin : scoring.setsToWin;
    const roundMatches: Match[] = [];
    for (let m = 0; m < remaining / 2; m++) {
      const rankA = order[m * 2];
      const rankB = order[m * 2 + 1];
      const half: Half = remaining === 2 ? 'mitte' : m < remaining / 4 ? 'links' : 'rechts';
      roundMatches.push(
        newMatch({
          phase: 'hauptrunde',
          tree,
          label,
          half,
          posInRound: m,
          pointsPerSet: points,
          setsToWin: sets,
          // Eigenrunde: die Vorrunde geht allen Hauptrunden voraus.
          round: r + playInOffset,
          a: r === 1 ? slot(null, '', rankA) : slot(null, ''),
          b: r === 1 ? slot(null, '', rankB) : slot(null, ''),
        }),
      );
    }
    previous.forEach((prev, index) => {
      const target = roundMatches[Math.floor(index / 2)];
      prev.nextMatchId = target.id;
      prev.nextSlot = index % 2 === 0 ? 'a' : 'b';
    });
    roundMatchesByRound.push(roundMatches);
    matches.push(...roundMatches);
    previous = roundMatches;
  }
  const firstMain = roundMatchesByRound[0];

  // Zugänge: direkt gesetzte Ränge.
  for (const match of firstMain) {
    for (const side of ['a', 'b'] as const) {
      const rank = match[side].rank;
      if (rank !== null && rank <= directCount) entries.set(rank, { match, side });
    }
  }

  // --- Vorrunde ----------------------------------------------------------
  const playInMatches: Match[] = [];
  for (let i = 0; i < playInCount; i++) {
    const targetRank = directCount + i + 1;
    const target = firstMain.find((m) => m.a.rank === targetRank || m.b.rank === targetRank);
    const playIn = newMatch({
      phase: 'vorrunde',
      tree,
      label: tree === 'trost' ? 'Trost-Vorrunde' : 'Vorrunde',
      half: halfOfRank(targetRank),
      posInRound: i,
      pointsPerSet: scoring.pointsPerSet,
      setsToWin: tree === 'trost' ? scoring.consolationSetsToWin : scoring.setsToWin,
      a: slot(null, ''),
      b: slot(null, ''),
    });
    if (target) {
      playIn.nextMatchId = target.id;
      playIn.nextSlot = target.a.rank === targetRank ? 'a' : 'b';
      target[playIn.nextSlot].source = tree === 'trost' ? 'Sieger Trost-Vorrunde' : 'Sieger Vorrunde';
    }
    playInMatches.push(playIn);
    // Zwei Zugänge je Vorrundenspiel: der stärkere und der schwächere Rang.
    entries.set(targetRank, { match: playIn, side: 'a' });
    entries.set(entryCount + 1 - (i + 1), { match: playIn, side: 'b' });
  }
  matches.unshift(...playInMatches);

  // --- Spiel um Platz 3 --------------------------------------------------
  if (options.thirdPlaceMatch && roundCount >= 2 && tree === 'haupt') {
    matches.push(
      newMatch({
        phase: 'hauptrunde',
        tree,
        label: 'Spiel um Platz 3',
        half: 'mitte',
        posInRound: 1,
        pointsPerSet: scoring.endgamePointsPerSet,
        setsToWin: scoring.setsToWin,
        isThirdPlace: true,
      }),
    );
  }

  return {
    matches,
    firstMatches: playInCount > 0 ? [...playInMatches, ...firstMain] : firstMain,
    entries,
    mainSize,
    playInCount,
    directCount,
  };
}

export interface BracketPlan {
  matches: Match[];
  warnings: string[];
  mainSize: number;
  playInCount: number;
  /** Anzahl der Plätze in der Trostrunde (0 = keine). */
  consolationSize: number;
}

export interface BracketOptions {
  thirdPlaceMatch: boolean;
  consolation: boolean;
  scoring: ScoringRules;
}

/**
 * Baut den kompletten Turnierplan.
 *
 * Hauptbaum: Vorjahresgewinner bekommen die vordersten Setzränge, der Rest
 * wird gelost. Passt die Teilnehmerzahl nicht auf eine Zweierpotenz, spielen
 * die hintersten Ränge eine Vorrunde – die Gesetzten sind davon ausgenommen,
 * solange es genug direkte Plätze gibt.
 *
 * Trostrunde: Wer sein erstes Spiel verliert – egal ob in der Vorrunde oder
 * in der ersten Hauptrunde – zieht in einen zweiten Baum ein.
 */
export function buildBracket(players: readonly Player[], rng: Rng, options: BracketOptions): BracketPlan {
  const warnings: string[] = [];
  const n = players.length;
  if (n < 2) {
    return {
      matches: [],
      warnings: ['Es werden mindestens zwei Personen gebraucht.'],
      mainSize: 0,
      playInCount: 0,
      consolationSize: 0,
    };
  }

  const champions = rng.shuffle(players.filter((p) => p.isChampion));
  const others = rng.shuffle(players.filter((p) => !p.isChampion));
  const ranked = [...champions, ...others];

  const main = buildSkeleton({
    tree: 'haupt',
    entryCount: n,
    thirdPlaceMatch: options.thirdPlaceMatch,
    scoring: options.scoring,
  });

  if (main.mainSize >= 4 ? champions.length > main.mainSize / 2 : champions.length > main.mainSize) {
    warnings.push(
      `Bei ${champions.length} Vorjahresgewinnern und ${main.mainSize} Plätzen im Hauptfeld lässt sich ein frühes Duell nicht vermeiden.`,
    );
  }
  if (champions.length > 4 && main.mainSize >= 16) {
    warnings.push(
      'Ab fünf Vorjahresgewinnern kann sich ein Duell schon im Viertelfinale ergeben – die erste Runde bleibt frei davon.',
    );
  }
  if (champions.length > main.directCount && main.playInCount > 0) {
    warnings.push(
      `Es gibt mehr Vorjahresgewinner als direkte Hauptfeld-Plätze – ${champions.length - main.directCount} davon müssen in die Vorrunde.`,
    );
  }

  // Teilnehmer auf ihre Setzränge setzen.
  ranked.forEach((player, index) => {
    const entry = main.entries.get(index + 1);
    if (!entry) return;
    entry.match[entry.side].playerId = player.id;
    entry.match[entry.side].source = index < main.directCount ? 'gesetzt' : 'Vorrunde';
  });

  const matches = [...main.matches];
  let consolationSize = 0;

  // --- Trostrunde --------------------------------------------------------
  if (options.consolation) {
    const sources = rng.shuffle(main.firstMatches);
    consolationSize = sources.length;
    if (consolationSize >= 2) {
      const trost = buildSkeleton({
        tree: 'trost',
        entryCount: consolationSize,
        thirdPlaceMatch: false,
        scoring: options.scoring,
      });
      sources.forEach((source, index) => {
        const entry = trost.entries.get(index + 1);
        if (!entry) return;
        source.loserNextMatchId = entry.match.id;
        source.loserNextSlot = entry.side;
      });
      matches.push(...trost.matches);
    } else {
      warnings.push('Für eine Trostrunde gibt es zu wenige Erstrunden-Verlierer.');
    }
  }

  assignRounds(matches);
  return { matches, warnings, mainSize: main.mainSize, playInCount: main.playInCount, consolationSize };
}

/**
 * Setzt die Rundennummern aus den Abhängigkeiten: Ein Spiel kann erst
 * stattfinden, wenn alle Spiele gelaufen sind, die Teilnehmer dorthin
 * schicken – Sieger wie Verlierer. Die im Baum vorgesehene Runde gilt dabei
 * als Untergrenze, damit die Vorrunde vor der ersten Hauptrunde liegt.
 */
export function assignRounds(matches: readonly Match[]): void {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const feeders = new Map<Id, Id[]>();
  for (const match of matches) {
    for (const target of [match.nextMatchId, match.loserNextMatchId]) {
      if (!target || !byId.has(target)) continue;
      const list = feeders.get(target) ?? [];
      list.push(match.id);
      feeders.set(target, list);
    }
  }
  const depth = new Map<Id, number>();
  const resolve = (id: Id, guard: Set<Id>): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (guard.has(id)) return 1;
    guard.add(id);
    const list = feeders.get(id) ?? [];
    const own = byId.get(id)?.round ?? 1;
    const fromFeeders = list.reduce((max, f) => Math.max(max, resolve(f, guard) + 1), 1);
    const value = Math.max(own, fromFeeders);
    guard.delete(id);
    depth.set(id, value);
    return value;
  };
  const resolved = new Map<Id, number>();
  for (const match of matches) resolved.set(match.id, resolve(match.id, new Set<Id>()));
  for (const match of matches) match.round = resolved.get(match.id) ?? match.round;

  // Das Spiel um Platz 3 hängt an denselben Halbfinals wie das Finale.
  const third = matches.find((m) => m.isThirdPlace);
  if (third) {
    const semis = matches.filter((m) => m.tree === 'haupt' && m.label === 'Halbfinale');
    third.round = semis.length > 0 ? Math.max(...semis.map((m) => m.round)) + 1 : third.round;
  }
}

/** Setzt die Herkunftstexte ("Sieger Spiel 4"). Läuft nach der Nummerierung. */
export function labelSources(matches: Match[]): void {
  const byId = new Map(matches.map((m) => [m.id, m]));
  for (const match of matches) {
    if (match.nextMatchId && match.nextSlot) {
      const target = byId.get(match.nextMatchId);
      if (target) target[match.nextSlot].source = `Sieger Spiel ${match.number}`;
    }
    if (match.loserNextMatchId && match.loserNextSlot) {
      const target = byId.get(match.loserNextMatchId);
      if (target) target[match.loserNextSlot].source = `Verlierer Spiel ${match.number}`;
    }
  }
  const third = matches.find((m) => m.isThirdPlace);
  if (!third) return;
  const semis = matches
    .filter((m) => m.tree === 'haupt' && !m.isThirdPlace && m.label === 'Halbfinale')
    .sort((a, b) => a.posInRound - b.posInRound);
  third.a.source = semis[0] ? `Verlierer Spiel ${semis[0].number}` : 'Verlierer Halbfinale';
  third.b.source = semis[1] ? `Verlierer Spiel ${semis[1].number}` : 'Verlierer Halbfinale';
}
