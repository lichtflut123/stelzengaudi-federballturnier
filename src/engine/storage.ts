import type { Half, Match, MatchOutcome, Phase, Player, SetScore, Slot, Tournament, Tree } from './types';
import { LIMITS, SCHEMA_VERSION, createTournament, defaultSettings } from './tournament';

export const STORAGE_KEY = 'stelzengaudi-federball:v3';
/** Größere Dateien sind kein Turnier mehr – und würden den Browser blockieren. */
export const MAX_IMPORT_BYTES = 4_000_000;

type Unknown = Record<string, unknown>;

function isObject(value: unknown): value is Unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback: string, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Entfernt Schlüssel, die den Prototyp verbiegen könnten. */
function safeObject(value: unknown): Unknown {
  if (!isObject(value)) return {};
  const out: Unknown = {};
  for (const [key, val] of Object.entries(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    out[key] = val;
  }
  return out;
}

function parsePlayer(raw: unknown): Player | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  if (raw.id.length === 0 || raw.id.length > 64) return null;
  return {
    id: raw.id,
    name: raw.name.slice(0, LIMITS.nameLength),
    isChampion: raw.isChampion === true,
    song: typeof raw.song === 'string' ? raw.song.slice(0, LIMITS.songLength) : '',
  };
}

function parseSlot(raw: unknown): Slot | null {
  if (!isObject(raw)) return null;
  return {
    playerId: typeof raw.playerId === 'string' ? raw.playerId : null,
    source: str(raw.source, '', 60),
    rank: typeof raw.rank === 'number' && Number.isInteger(raw.rank) ? raw.rank : null,
  };
}

function parseSets(raw: unknown): SetScore[] {
  return arr(raw)
    .map((s) => {
      if (!isObject(s) || !Number.isFinite(s.a) || !Number.isFinite(s.b)) return null;
      const a = int(s.a, 0, 999, 0);
      const b = int(s.b, 0, 999, 0);
      // Ein Satz ohne Sieger ist kein Satz.
      return a === b ? null : { a, b };
    })
    .filter((s): s is SetScore => s !== null)
    .slice(0, 5);
}

/** Nur die Sätze, nach denen das Spiel noch offen ist. */
function undecidedPrefix(sets: SetScore[], setsToWin: 1 | 2): SetScore[] {
  const out: SetScore[] = [];
  let a = 0;
  let b = 0;
  for (const set of sets) {
    if (a >= setsToWin || b >= setsToWin) break;
    out.push(set);
    if (set.a > set.b) a += 1;
    else b += 1;
    if (a >= setsToWin || b >= setsToWin) out.pop();
  }
  return out;
}

const OUTCOMES: MatchOutcome[] = ['offen', 'gespielt', 'kampflos'];
const PHASES: Phase[] = ['vorrunde', 'hauptrunde'];
const HALVES: Half[] = ['links', 'rechts', 'mitte'];
const TREES: Tree[] = ['haupt', 'trost'];

interface SetsDefaults {
  haupt: 1 | 2;
  trost: 1 | 2;
}

function parseMatch(raw: unknown, maxRound: number, setsDefaults: SetsDefaults): Match | null {
  if (!isObject(raw) || typeof raw.id !== 'string') return null;
  if (raw.id.length === 0 || raw.id.length > 64) return null;
  const a = parseSlot(raw.a);
  const b = parseSlot(raw.b);
  if (!a || !b) return null;
  const resultFor = Array.isArray(raw.resultFor) && raw.resultFor.length === 2
    ? ([
        typeof raw.resultFor[0] === 'string' ? raw.resultFor[0] : null,
        typeof raw.resultFor[1] === 'string' ? raw.resultFor[1] : null,
      ] as [string | null, string | null])
    : null;
  const outcome = OUTCOMES.includes(raw.outcome as MatchOutcome) ? (raw.outcome as MatchOutcome) : 'offen';
  const sets = parseSets(raw.sets);
  // Sieger nur übernehmen, wenn das Spiel auch als entschieden gilt –
  // sonst gälte ein Spiel gleichzeitig als offen und als gewonnen.
  const winnerId = outcome !== 'offen' && typeof raw.winnerId === 'string' ? raw.winnerId : null;
  const tree: Tree = TREES.includes(raw.tree as Tree) ? (raw.tree as Tree) : 'haupt';
  // Alte Stände kennen das Feld noch nicht: dann gilt die Zählweise des Baums.
  const fallbackSets = tree === 'trost' ? setsDefaults.trost : setsDefaults.haupt;
  const setsToWin = int(raw.setsToWin, 1, 2, fallbackSets) === 1 ? 1 : 2;
  return {
    id: raw.id,
    number: int(raw.number, 0, 100000, 0),
    phase: PHASES.includes(raw.phase as Phase) ? (raw.phase as Phase) : 'hauptrunde',
    tree,
    pointsPerSet: int(raw.pointsPerSet, 1, LIMITS.pointsPerSet, 21),
    setsToWin,
    // Runden werden geklemmt: ohne Grenze könnte ein manipulierter Wert
    // die Neuberechnung beliebig lange laufen lassen.
    round: int(raw.round, 1, maxRound, 1),
    label: str(raw.label, '', 40),
    half: HALVES.includes(raw.half as Half) ? (raw.half as Half) : 'links',
    posInRound: int(raw.posInRound, 0, 100000, 0),
    slot: int(raw.slot, 1, 100000, 1),
    court: int(raw.court, 1, LIMITS.courts, 1),
    a,
    b,
    sets: winnerId === null ? [] : sets,
    // Zwischenstand nur bei wirklich offenen Spielen – samt Paarungsbindung.
    // Höchstens so viele Sätze, wie ein LAUFENDES Spiel haben kann: sobald
    // eine Seite genug Sätze hätte, wäre es entschieden und gewertet.
    liveSets: winnerId === null ? undecidedPrefix(parseSets(raw.liveSets), setsToWin) : [],
    liveFor:
      winnerId === null &&
      Array.isArray(raw.liveSets) &&
      raw.liveSets.length > 0 &&
      Array.isArray(raw.liveFor) &&
      raw.liveFor.length === 2
        ? ([
            typeof raw.liveFor[0] === 'string' ? raw.liveFor[0] : null,
            typeof raw.liveFor[1] === 'string' ? raw.liveFor[1] : null,
          ] as [string | null, string | null])
        : null,
    outcome,
    winnerId,
    resultFor: winnerId === null ? null : resultFor,
    nextMatchId: typeof raw.nextMatchId === 'string' ? raw.nextMatchId : null,
    nextSlot: raw.nextSlot === 'a' || raw.nextSlot === 'b' ? raw.nextSlot : null,
    loserNextMatchId: typeof raw.loserNextMatchId === 'string' ? raw.loserNextMatchId : null,
    loserNextSlot: raw.loserNextSlot === 'a' || raw.loserNextSlot === 'b' ? raw.loserNextSlot : null,
    isThirdPlace: raw.isThirdPlace === true,
  };
}

/**
 * Macht aus beliebigen – auch beschädigten oder böswillig veränderten –
 * Daten ein gültiges Turnier oder gibt null zurück. Jedes Feld wird geprüft
 * und geklemmt; nichts wird ungeprüft übernommen.
 */
export function migrate(raw: unknown): Tournament | null {
  if (!isObject(raw)) return null;
  // Mindestens eines der Turnierfelder muss vorhanden sein – sonst wäre jede
  // beliebige JSON-Datei ein „gültiges Turnier".
  const looksLikeTournament =
    Array.isArray(raw.players) || Array.isArray(raw.matches) || typeof raw.version === 'number';
  if (!looksLikeTournament) return null;
  const base = createTournament();
  const fallbackSettings = defaultSettings();
  const settings = safeObject(raw.settings);
  const scoring = safeObject(settings.scoring);

  const seenPlayers = new Set<string>();
  const players = arr(raw.players)
    .map(parsePlayer)
    .filter((p): p is Player => p !== null)
    // Doppelte Ids würden in der Anzeige Zeilen vertauschen lassen.
    .filter((p) => (seenPlayers.has(p.id) ? false : (seenPlayers.add(p.id), true)))
    .slice(0, LIMITS.players);
  const knownIds = new Set(players.map((p) => p.id));

  const setsDefaults: SetsDefaults = {
    haupt: int(scoring.setsToWin, 1, 2, fallbackSettings.scoring.setsToWin) === 2 ? 2 : 1,
    // Alte Stände (vor der Trostrunden-Verkürzung) spielten überall gleich.
    trost:
      int(
        scoring.consolationSetsToWin,
        1,
        2,
        int(scoring.setsToWin, 1, 2, fallbackSettings.scoring.setsToWin) === 2 ? 2 : 1,
      ) === 2
        ? 2
        : 1,
  };

  const rawMatches = arr(raw.matches).slice(0, LIMITS.matches);
  const seenMatches = new Set<string>();
  const matches = rawMatches
    .map((m) => parseMatch(m, Math.max(1, rawMatches.length), setsDefaults))
    .filter((m): m is Match => m !== null)
    .filter((m) => (seenMatches.has(m.id) ? false : (seenMatches.add(m.id), true)));

  // Verweise auf unbekannte Personen entfernen, statt sie mitzuschleppen.
  const matchIds = new Set(matches.map((m) => m.id));
  for (const match of matches) {
    for (const side of ['a', 'b'] as const) {
      if (match[side].playerId && !knownIds.has(match[side].playerId as string)) {
        match[side].playerId = null;
      }
    }
    if (match.winnerId && !knownIds.has(match.winnerId)) {
      match.winnerId = null;
      match.outcome = 'offen';
      match.sets = [];
      match.resultFor = null;
    }
    if (match.nextMatchId && (!matchIds.has(match.nextMatchId) || match.nextMatchId === match.id)) {
      match.nextMatchId = null;
      match.nextSlot = null;
    }
    if (match.loserNextMatchId && (!matchIds.has(match.loserNextMatchId) || match.loserNextMatchId === match.id)) {
      match.loserNextMatchId = null;
      match.loserNextSlot = null;
    }
    if (match.a.playerId && match.a.playerId === match.b.playerId) {
      // Niemand spielt gegen sich selbst.
      match.b.playerId = null;
      match.winnerId = null;
      match.outcome = 'offen';
      match.sets = [];
      match.resultFor = null;
    }
  }

  const pointsPerSet = int(scoring.pointsPerSet, 1, LIMITS.pointsPerSet, fallbackSettings.scoring.pointsPerSet);
  return {
    version: SCHEMA_VERSION,
    id: str(raw.id, base.id, 60),
    createdAt: str(raw.createdAt, base.createdAt, 40),
    settings: {
      name: str(settings.name, fallbackSettings.name, LIMITS.titleLength),
      courts: int(settings.courts, 1, LIMITS.courts, fallbackSettings.courts),
      thirdPlaceMatch: bool(settings.thirdPlaceMatch, fallbackSettings.thirdPlaceMatch),
      consolation: bool(settings.consolation, fallbackSettings.consolation),
      scoring: {
        setsToWin: int(scoring.setsToWin, 1, 2, fallbackSettings.scoring.setsToWin) === 2 ? 2 : 1,
        pointsPerSet,
        endgamePointsPerSet: int(
          scoring.endgamePointsPerSet,
          1,
          LIMITS.pointsPerSet,
          fallbackSettings.scoring.endgamePointsPerSet,
        ),
        winByTwo: bool(scoring.winByTwo, fallbackSettings.scoring.winByTwo),
        cap: int(scoring.cap, 0, LIMITS.cap, fallbackSettings.scoring.cap),
        consolationSetsToWin:
          int(scoring.consolationSetsToWin, 1, 2, fallbackSettings.scoring.consolationSetsToWin) === 2 ? 2 : 1,
        freeScoring: bool(scoring.freeScoring, fallbackSettings.scoring.freeScoring),
      },
    },
    players,
    matches,
    drawSeed: typeof raw.drawSeed === 'number' && Number.isFinite(raw.drawSeed) ? raw.drawSeed : null,
    drawnAt: typeof raw.drawnAt === 'string' ? raw.drawnAt.slice(0, 40) : null,
    drawWarnings: arr(raw.drawWarnings)
      .filter((w): w is string => typeof w === 'string')
      .map((w) => w.slice(0, 300))
      .slice(0, 20),
  };
}

function storage(): Storage | null {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = '__federball_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

/** Zustand des Speichers, ohne etwas zu überschreiben. */
export function storageState(): SaveResult {
  try {
    const s = globalThis.localStorage;
    if (!s) return 'gesperrt';
    const probe = '__federball_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return 'ok';
  } catch (e) {
    return quotaError(e) ? 'voll' : 'gesperrt';
  }
}

export function loadTournament(): Tournament | null {
  // Bewusst ohne Schreibprobe: bei vollem Speicher scheitert die Probe,
  // der gespeicherte Stand ist aber weiterhin lesbar.
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    return migrate(JSON.parse(raw));
  } catch {
    return null;
  }
}

export type SaveResult = 'ok' | 'voll' | 'gesperrt';

function quotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: number }).code;
  return e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || code === 22;
}

export function saveTournament(t: Tournament): SaveResult {
  // Direkt schreiben statt vorher zu proben: nur so lässt sich "Speicher voll"
  // von "Speichern gesperrt" unterscheiden.
  try {
    const s = globalThis.localStorage;
    if (!s) return 'gesperrt';
    s.setItem(STORAGE_KEY, JSON.stringify(t));
    return 'ok';
  } catch (e) {
    return quotaError(e) ? 'voll' : 'gesperrt';
  }
}

export function clearStorage(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    /* nichts zu tun */
  }
}

export function exportJson(t: Tournament): string {
  return JSON.stringify(t, null, 2);
}

export function importJson(text: string): Tournament {
  if (text.length > MAX_IMPORT_BYTES) {
    throw new Error('Die Datei ist zu groß für ein Turnier.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Diese Datei lässt sich nicht lesen – bitte eine mit „Exportieren“ erzeugte Datei wählen.');
  }
  let result: Tournament | null = null;
  try {
    result = migrate(parsed);
  } catch {
    throw new Error('Die Datei enthält kein gültiges Turnier.');
  }
  if (!result) throw new Error('Die Datei enthält kein gültiges Turnier.');
  return result;
}
