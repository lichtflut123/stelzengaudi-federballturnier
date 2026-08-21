import { describe, expect, it } from 'vitest';
import {
  checkSetup,
  consolationWinner,
  recompute,
  clearResult,
  createPlayer,
  createTournament,
  eliminatedIn,
  isFinished,
  matchCount,
  nextYear,
  performDraw,
  podium,
  progress,
  setLiveSets,
  setResult,
  setWalkover,
} from '../tournament';
import { currentAndNext } from '../schedule';
import type { Id, Tournament } from '../types';

const NAMES = ['Anna', 'Ben', 'Carla', 'David', 'Emil', 'Frida', 'Gustav', 'Hanna', 'Ida', 'Jonas', 'Klara'];
const SIMPLE = { consolation: false, thirdPlaceMatch: true };

function withPlayers(names: string[], champions: string[] = [], settings = {}): Tournament {
  return {
    ...createTournament({ ...SIMPLE, ...settings }),
    players: names.map((n) => createPlayer(n, champions.includes(n))),
  };
}

/** Ergebnis, das für jede Punktzahl gültig ist (zwei Gewinnsätze). */
function win(points: number, setsToWin: 1 | 2 = 2): { a: number; b: number }[] {
  const sets = [
    { a: points, b: Math.max(0, points - 5) },
    { a: points, b: Math.max(0, points - 7) },
  ];
  return sets.slice(0, setsToWin);
}

/** Gültiges Siegergebnis für genau dieses Spiel. */
function winFor(match: Tournament['matches'][number]): { a: number; b: number }[] {
  return win(match.pointsPerSet, match.setsToWin);
}

/** Spielt alle Spiele durch; die zuerst genannte Person gewinnt. */
function playAll(t: Tournament): Tournament {
  let current = t;
  for (let guard = 0; guard < 500; guard++) {
    const next = current.matches.find((m) => m.winnerId === null && m.a.playerId && m.b.playerId);
    if (!next) return current;
    current = setResult(current, next.id, winFor(next));
  }
  throw new Error('Turnier wurde nicht fertig');
}

describe('checkSetup', () => {
  it('braucht mindestens zwei Personen', () => {
    expect(checkSetup(withPlayers(['Anna'])).errors.length).toBeGreaterThan(0);
    expect(checkSetup(withPlayers(['Anna', 'Ben'])).errors).toEqual([]);
  });

  it('meldet leere Namen', () => {
    expect(checkSetup(withPlayers(['Anna', 'Ben', '   '])).errors.join(' ')).toMatch(/ohne Namen/);
  });

  it('warnt bei doppelten Namen', () => {
    expect(checkSetup(withPlayers(['Anna', 'anna', 'Ben'])).warnings.join(' ')).toMatch(/Doppelte Namen/);
  });

  it('warnt bei einer wirkungslosen Obergrenze, blockiert aber nicht', () => {
    const t = withPlayers(NAMES.slice(0, 4), [], {
      scoring: { setsToWin: 1, pointsPerSet: 21, endgamePointsPerSet: 21, winByTwo: true, cap: 15, freeScoring: false },
    });
    const check = checkSetup(t);
    expect(check.errors).toEqual([]);
    expect(check.warnings.join(' ')).toMatch(/Obergrenze/);
  });

  it('lehnt unsinnige Zahlenwerte ab', () => {
    const t = withPlayers(NAMES.slice(0, 4), [], { courts: Number.NaN });
    expect(checkSetup(t).errors.length).toBeGreaterThan(0);
    const t2 = withPlayers(NAMES.slice(0, 4), [], { courts: 0 });
    expect(checkSetup(t2).errors.length).toBeGreaterThan(0);
  });

  it('zeigt eine Vorschau mit Vorrunde und Spielzahl', () => {
    const check = checkSetup(withPlayers(NAMES.slice(0, 11)));
    expect(check.preview).toMatchObject({ mainSize: 8, playInCount: 3, consolationSize: 0, totalMatches: 11 });
  });

  it('warnt, wenn zu viele Vorjahresgewinner markiert sind', () => {
    const t = withPlayers(NAMES.slice(0, 8), NAMES.slice(0, 6));
    expect(checkSetup(t).warnings.join(' ')).toMatch(/Duell|Vorrunde/);
  });
});

describe('matchCount', () => {
  it('entspricht der K.-o.-Regel: ein Spiel je Ausscheiden', () => {
    expect(matchCount(2, false, false)).toBe(1);
    expect(matchCount(8, false, false)).toBe(7);
    expect(matchCount(8, true, false)).toBe(8);
    expect(matchCount(11, true, false)).toBe(11);
    expect(matchCount(2, true, false)).toBe(1);
    // Mit Trostrunde kommen die Verlierer der ersten Spiele dazu.
    expect(matchCount(8, true, true)).toBe(8 + 3);
    expect(matchCount(12, true, true)).toBe(12 + 7);
  });
});

describe('performDraw', () => {
  it('erzeugt genau so viele Spiele wie nötig', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 16, 17]) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      const t = performDraw(withPlayers(names), n);
      expect(t.matches).toHaveLength(matchCount(n, true, false));
    }
  });

  it('vergibt eindeutige, lückenlose Spielnummern', () => {
    const t = performDraw(withPlayers(NAMES, ['Anna', 'Ben']), 7);
    const numbers = t.matches.map((m) => m.number).sort((a, b) => a - b);
    expect(numbers).toEqual(numbers.map((_, i) => i + 1));
  });

  it('ist mit gleicher Losnummer reproduzierbar', () => {
    const base = withPlayers(NAMES, ['Anna']);
    const key = (t: Tournament) =>
      t.matches.map((m) => `${m.number}:${m.a.playerId}-${m.b.playerId}`).join('|');
    expect(key(performDraw(base, 4242))).toEqual(key(performDraw(base, 4242)));
    expect(key(performDraw(base, 1))).not.toEqual(key(performDraw(base, 2)));
  });

  it('lässt Vorjahresgewinner nie in Runde 1 aufeinandertreffen', () => {
    for (const [n, champs] of [[8, 2], [16, 4], [11, 3], [13, 4], [7, 2], [32, 8]] as const) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      for (let seed = 0; seed < 40; seed++) {
        const t = performDraw(withPlayers(names, names.slice(0, champs)), seed);
        const championIds = new Set(t.players.filter((p) => p.isChampion).map((p) => p.id));
        const firstRound = t.matches.filter((m) => m.round === Math.min(...t.matches.map((x) => x.round)));
        for (const m of firstRound) {
          const both = championIds.has(m.a.playerId ?? '') && championIds.has(m.b.playerId ?? '');
          expect(both, `n=${n} champs=${champs} seed=${seed}`).toBe(false);
        }
      }
    }
  });

  it('belegt jedes Feld je Zeitfenster nur einmal', () => {
    for (const courts of [1, 2, 3, 5]) {
      const t = performDraw(withPlayers(NAMES, ['Anna'], { courts }), 9);
      const seen = new Map<number, Set<number>>();
      for (const m of t.matches) {
        const set = seen.get(m.slot) ?? new Set<number>();
        expect(set.has(m.court)).toBe(false);
        set.add(m.court);
        seen.set(m.slot, set);
        expect(m.court).toBeLessThanOrEqual(courts);
      }
    }
  });

  it('lässt niemanden zwei Spiele gleichzeitig bestreiten', () => {
    for (let seed = 0; seed < 20; seed++) {
      const t = performDraw(withPlayers(NAMES, ['Anna'], { courts: 3 }), seed);
      const perSlot = new Map<number, Set<Id>>();
      for (const m of t.matches) {
        const set = perSlot.get(m.slot) ?? new Set<Id>();
        for (const id of [m.a.playerId, m.b.playerId]) {
          if (!id) continue;
          expect(set.has(id)).toBe(false);
          set.add(id);
        }
        perSlot.set(m.slot, set);
      }
    }
  });

  it('lässt auch mit Trostrunde und Spiel um Platz 3 niemanden zwei Spiele gleichzeitig bestreiten', () => {
    // Bei 4-7 Personen speisen die Halbfinal-Verlierer sowohl das Spiel um
    // Platz 3 als auch die Trostrunde - mit 3 Feldern dürfen diese Spiele
    // deshalb nicht im selben Zeitfenster liegen. Durchgespielt geprüft,
    // weil die Besetzung späterer Runden erst mit den Ergebnissen feststeht.
    for (let n = 4; n <= 8; n++) {
      for (let seed = 0; seed < 10; seed++) {
        const t = playAll(
          performDraw(
            withPlayers(NAMES.slice(0, n), [], { consolation: true, thirdPlaceMatch: true, courts: 3 }),
            seed,
          ),
        );
        const perSlot = new Map<number, Set<Id>>();
        for (const m of t.matches) {
          const set = perSlot.get(m.slot) ?? new Set<Id>();
          for (const id of [m.a.playerId, m.b.playerId]) {
            if (!id) continue;
            expect(set.has(id), `Person doppelt in Zeitfenster ${m.slot} (n=${n}, Los ${seed})`).toBe(false);
            set.add(id);
          }
          perSlot.set(m.slot, set);
        }
      }
    }
  });

  it('setzt Vorrundenspiele vor die Hauptrunde', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 11)), 5);
    const playIn = t.matches.filter((m) => m.phase === 'vorrunde');
    const main = t.matches.filter((m) => m.phase === 'hauptrunde');
    expect(playIn).toHaveLength(3);
    expect(Math.max(...playIn.map((m) => m.slot))).toBeLessThan(Math.min(...main.map((m) => m.slot)));
  });
});

describe('Ergebnisse', () => {
  it('rückt den Sieger auf', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const semi = t.matches.find((m) => m.label === 'Halbfinale') as Tournament['matches'][number];
    t = setResult(t, semi.id, win(semi.pointsPerSet));
    const final = t.matches.find((m) => m.label === 'Finale');
    expect([final?.a.playerId, final?.b.playerId]).toContain(semi.a.playerId);
  });

  it('lehnt ungültige Ergebnisse ab', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const semi = t.matches[0];
    expect(() => setResult(t, semi.id, [{ a: semi.pointsPerSet, b: semi.pointsPerSet - 1 }])).toThrow();
    expect(() => setResult(t, semi.id, [{ a: 2, b: 1 }])).toThrow();
    expect(() => setResult(t, 'gibtsnicht', [{ a: 21, b: 1 }])).toThrow();
  });

  it('löscht ein Folgeergebnis, wenn sich der SIEGER des Vorspiels ändert', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4), [], { thirdPlaceMatch: false }), 5);
    const semis = t.matches.filter((m) => m.label === 'Halbfinale');
    t = setResult(t, semis[0].id, win(semis[0].pointsPerSet));
    t = setResult(t, semis[1].id, win(semis[1].pointsPerSet));
    const final = t.matches.find((m) => m.label === 'Finale') as Tournament['matches'][number];
    t = setResult(t, final.id, win(final.pointsPerSet));
    expect(t.matches.find((m) => m.id === final.id)?.winnerId).toBeTruthy();

    t = setResult(t, semis[0].id, win(semis[0].pointsPerSet).map((x) => ({ a: x.b, b: x.a })));
    const after = t.matches.find((m) => m.id === final.id);
    expect(after?.winnerId).toBe(null);
    expect(after?.outcome).toBe('offen');
    expect(after?.sets).toEqual([]);
  });

  it('löscht ein Folgeergebnis auch, wenn sich nur der GEGNER ändert', () => {
    // Der Sieger bleibt derselbe, der Gegner wechselt: ohne Bindung des
    // Ergebnisses an die Paarung würde ein nie gespieltes Resultat stehen bleiben.
    let t = performDraw(withPlayers(NAMES.slice(0, 8), [], { thirdPlaceMatch: false }), 42);
    const quarters = t.matches.filter((m) => m.label === 'Viertelfinale');
    for (const q of quarters) t = setResult(t, q.id, win(q.pointsPerSet));
    const semis = t.matches.filter((m) => m.label === 'Halbfinale');
    const semi = semis[0];
    const semiWinnerSide = 'a' as const;
    t = setResult(t, semi.id, win(semi.pointsPerSet));
    const winnerBefore = t.matches.find((m) => m.id === semi.id)?.winnerId;
    expect(winnerBefore).toBe(semi[semiWinnerSide].playerId);

    // Das Viertelfinale drehen, das den GEGNER dieses Halbfinales liefert.
    const feeder = quarters.find((q) => q.nextMatchId === semi.id && q.nextSlot === 'b');
    expect(feeder).toBeTruthy();
    t = setResult(t, (feeder as Tournament['matches'][number]).id, win(feeder!.pointsPerSet).map((x) => ({ a: x.b, b: x.a })));

    const semiAfter = t.matches.find((m) => m.id === semi.id);
    expect(semiAfter?.b.playerId).not.toBe(semi.b.playerId);
    expect(semiAfter?.winnerId).toBe(null);
    expect(semiAfter?.outcome).toBe('offen');
    expect(semiAfter?.sets).toEqual([]);
  });

  it('räumt auch das Spiel um Platz 3 auf', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4), [], { thirdPlaceMatch: true }), 7);
    const semis = t.matches.filter((m) => m.label === 'Halbfinale');
    t = setResult(t, semis[0].id, win(semis[0].pointsPerSet));
    t = setResult(t, semis[1].id, win(semis[1].pointsPerSet));
    const third = t.matches.find((m) => m.isThirdPlace) as Tournament['matches'][number];
    expect(third.a.playerId).toBeTruthy();
    t = setResult(t, third.id, win(third.pointsPerSet));
    expect(t.matches.find((m) => m.id === third.id)?.winnerId).toBeTruthy();

    t = setResult(t, semis[0].id, win(semis[0].pointsPerSet).map((x) => ({ a: x.b, b: x.a })));
    const thirdAfter = t.matches.find((m) => m.id === third.id);
    expect(thirdAfter?.winnerId).toBe(null);
  });

  it('kann Ergebnisse löschen', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const semi = t.matches[0];
    t = setResult(t, semi.id, win(semi.pointsPerSet));
    t = clearResult(t, semi.id);
    expect(t.matches.find((m) => m.id === semi.id)?.outcome).toBe('offen');
    const final = t.matches.find((m) => m.label === 'Finale');
    expect(final?.a.playerId ?? final?.b.playerId).toBeFalsy();
  });

  it('unterstützt kampflose Siege', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const semi = t.matches[0];
    const winner = semi.a.playerId as Id;
    t = setWalkover(t, semi.id, winner);
    expect(t.matches.find((m) => m.id === semi.id)).toMatchObject({ outcome: 'kampflos', winnerId: winner });
    expect(() => setWalkover(t, semi.id, 'fremd')).toThrow();
  });

  it('verhindert Ergebnisse für unbesetzte Spiele', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const final = t.matches.find((m) => m.label === 'Finale') as Tournament['matches'][number];
    expect(() => setResult(t, final.id, win(final.pointsPerSet))).toThrow();
    expect(() => setWalkover(t, final.id, t.players[0].id)).toThrow();
  });
});

describe('Turnierverlauf', () => {
  it('führt jede Teilnehmerzahl bis zum Sieger', () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 16, 17, 24, 32]) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      let t = performDraw(withPlayers(names, ['P0']), n * 3);
      t = playAll(t);
      expect(isFinished(t), `n=${n}`).toBe(true);
      expect(progress(t).percent).toBe(100);
      const places = podium(t);
      expect(places[0]?.place).toBe(1);
      expect(new Set(places.map((p) => p.playerId)).size).toBe(places.length);
    }
  });

  it('zeigt keinen Endstand, solange das Finale offen ist', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 3);
    expect(podium(t)).toEqual([]);
    const semis = t.matches.filter((m) => m.label === 'Halbfinale');
    t = setResult(t, semis[0].id, win(semis[0].pointsPerSet));
    expect(podium(t)).toEqual([]);
  });

  it('kennt die Runde des Ausscheidens', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 3);
    const semi = t.matches.find((m) => m.label === 'Halbfinale') as Tournament['matches'][number];
    const loser = semi.b.playerId as Id;
    t = setResult(t, semi.id, win(semi.pointsPerSet));
    expect(eliminatedIn(t, loser)).toBe('Halbfinale');
    expect(eliminatedIn(t, semi.a.playerId as Id)).toBe(null);
  });

  it('zeigt an, was gerade dran ist', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 8), [], { courts: 2 }), 11);
    const { now, next } = currentAndNext(t.matches);
    expect(now.length).toBe(2);
    expect(now.every((m) => m.slot === now[0].slot)).toBe(true);
    expect(next.length).toBeGreaterThan(0);
    expect(next[0].slot).toBeGreaterThan(now[0].slot);
  });

  it('macht aus dem Sieger den Vorjahresgewinner des nächsten Turniers', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 3);
    t = playAll(t);
    const winnerName = t.players.find((p) => p.id === podium(t)[0].playerId)?.name;
    const next = nextYear(t);
    expect(next.matches).toEqual([]);
    expect(next.players).toHaveLength(4);
    expect(next.players.filter((p) => p.isChampion).map((p) => p.name)).toEqual([winnerName]);
  });
});


describe('Trostrunde im Verlauf', () => {
  const withTrost = (names: string[], champions: string[] = []) => ({
    ...createTournament({ consolation: true, thirdPlaceMatch: true }),
    players: names.map((n) => createPlayer(n, champions.includes(n))),
  });

  it('schickt jeden Verlierer des ersten Spiels in die Trostrunde', () => {
    let t = performDraw(withTrost(NAMES.slice(0, 8), ['Anna']), 12);
    const firstRound = Math.min(...t.matches.filter((m) => m.tree === 'haupt').map((m) => m.round));
    const first = t.matches.filter((m) => m.tree === 'haupt' && m.round === firstRound);
    const losers: Id[] = [];
    for (const m of first) {
      t = setResult(t, m.id, winFor(m));
      losers.push(m.b.playerId as Id);
    }
    const trostStart = t.matches.filter(
      (m) => m.tree === 'trost' && m.round === Math.min(...t.matches.filter((x) => x.tree === 'trost').map((x) => x.round)),
    );
    const inTrost = trostStart.flatMap((m) => [m.a.playerId, m.b.playerId]).filter(Boolean);
    expect(new Set(inTrost)).toEqual(new Set(losers));
  });

  it('führt Haupt- und Trostrunde zu je einem Sieger', () => {
    for (const n of [4, 5, 8, 11, 12, 16]) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      let t = performDraw(withTrost(names, ['P0']), n * 7);
      t = playAll(t);
      expect(isFinished(t), `n=${n}`).toBe(true);
      expect(podium(t)[0]?.place).toBe(1);
      expect(consolationWinner(t), `n=${n}`).toBeTruthy();
      // Der Trostsieger ist nicht der Turniersieger.
      expect(consolationWinner(t)).not.toBe(podium(t)[0].playerId);
    }
  });

  it('gibt jeder Person mindestens zwei Spiele', () => {
    for (const n of [4, 8, 12, 16]) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`);
      let t = performDraw(withTrost(names), n * 11);
      t = playAll(t);
      const counts = new Map<Id, number>();
      for (const m of t.matches) {
        for (const id of [m.a.playerId, m.b.playerId]) {
          if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
      for (const p of t.players) {
        expect(counts.get(p.id) ?? 0, `n=${n} ${p.name}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('räumt die Trostrunde auf, wenn ein Erstrundenergebnis gedreht wird', () => {
    let t = performDraw(withTrost(NAMES.slice(0, 8)), 21);
    t = playAll(t);
    const firstRound = Math.min(...t.matches.filter((m) => m.tree === 'haupt').map((m) => m.round));
    const first = t.matches.find((m) => m.tree === 'haupt' && m.round === firstRound) as Tournament['matches'][number];
    const trostFollow = t.matches.find((m) => m.id === first.loserNextMatchId);
    expect(trostFollow?.winnerId).toBeTruthy();

    t = setResult(t, first.id, winFor(first).map((x) => ({ a: x.b, b: x.a })));
    const after = t.matches.find((m) => m.id === trostFollow?.id);
    expect(after?.winnerId).toBe(null);
    expect(after?.outcome).toBe('offen');
  });

  it('zählt in der Trostrunde mit der normalen Punktzahl weiter', () => {
    const t = performDraw(withTrost(NAMES.slice(0, 8)), 3);
    const rules = t.settings.scoring;
    for (const m of t.matches.filter((x) => x.tree === 'trost')) {
      expect(m.pointsPerSet).toBe(rules.pointsPerSet);
    }
    const half = t.matches.find((m) => m.label === 'Halbfinale');
    expect(half?.pointsPerSet).toBe(rules.endgamePointsPerSet);
  });
});

describe('Widerstandsfähigkeit von recompute', () => {
  it('traut einem Sieger nicht, solange das Spiel als offen gilt', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const fremd = t.players[3].id;
    const manipuliert: Tournament = {
      ...t,
      matches: t.matches.map((m) => ({ ...m, outcome: 'offen' as const, winnerId: fremd })),
    };
    const clean = recompute(manipuliert);
    expect(clean.matches.every((m) => m.winnerId === null)).toBe(true);
    expect(podium(clean)).toEqual([]);
    expect(progress(clean).played).toBe(0);
  });

  it('verwirft ein Ergebnis, wenn beide Seiten dieselbe Person zeigen', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 4)), 5);
    const semi = t.matches[0];
    const solo = semi.a.playerId as Id;
    const manipuliert: Tournament = {
      ...t,
      matches: t.matches.map((m) =>
        m.id === semi.id
          ? { ...m, b: { ...m.b, playerId: solo }, outcome: 'gespielt' as const, winnerId: solo, resultFor: [solo, solo] as [Id, Id] }
          : m,
      ),
    };
    const clean = recompute(manipuliert);
    expect(clean.matches.find((m) => m.id === semi.id)?.winnerId).toBe(null);
  });
});

describe('Schiri-Modus (setLiveSets)', () => {
  it('hält fertige Sätze fest, ohne das Spiel zu werten', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 8)), 8);
    const m = t.matches[0];
    t = setLiveSets(t, m.id, [{ a: 12, b: 7 }]);
    const after = t.matches.find((x) => x.id === m.id);
    expect(after?.liveSets).toEqual([{ a: 12, b: 7 }]);
    expect(after?.outcome).toBe('offen');
    expect(after?.winnerId).toBe(null);
    expect(progress(t).played).toBe(0);
  });

  it('wertet das Spiel regulär, sobald die Sätze einen Sieger ergeben', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 8)), 8);
    const m = t.matches[0];
    t = setLiveSets(t, m.id, [{ a: 12, b: 7 }]);
    t = setLiveSets(t, m.id, [{ a: 12, b: 7 }, { a: 12, b: 9 }]);
    const after = t.matches.find((x) => x.id === m.id);
    expect(after?.outcome).toBe('gespielt');
    expect(after?.winnerId).toBe(m.a.playerId);
    expect(after?.liveSets).toEqual([]);
    expect(after?.sets).toHaveLength(2);
  });

  it('lehnt ungültige Sätze ab', () => {
    const t = performDraw(withPlayers(NAMES.slice(0, 8)), 8);
    const m = t.matches[0];
    expect(() => setLiveSets(t, m.id, [{ a: 12, b: 11 }])).toThrow();
    expect(() => setLiveSets(t, m.id, [{ a: 5, b: 3 }])).toThrow();
  });

  it('prüft gegen die Punktzahl des Spiels (Halbfinale bis 21)', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 4)), 8);
    // Bei 4 Personen ist Runde 1 schon das Halbfinale (bis 21).
    const semi = t.matches.find((m) => m.label === 'Halbfinale') as Tournament['matches'][number];
    expect(() => setLiveSets(t, semi.id, [{ a: 12, b: 7 }])).toThrow();
    t = setLiveSets(t, semi.id, [{ a: 21, b: 15 }]);
    expect(t.matches.find((m) => m.id === semi.id)?.liveSets).toHaveLength(1);
  });

  it('verwirft den Zwischenstand, wenn die Paarung zerfällt', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 8)), 9);
    const firstRound = Math.min(...t.matches.filter((m) => m.tree === 'haupt').map((m) => m.round));
    const first = t.matches.find((m) => m.tree === 'haupt' && m.round === firstRound) as Tournament['matches'][number];
    // Beide Zubringer des Folgespiels spielen, damit es voll besetzt ist.
    const sibling = t.matches.find(
      (m) => m.id !== first.id && m.nextMatchId === first.nextMatchId,
    ) as Tournament['matches'][number];
    t = setResult(t, first.id, winFor(first));
    t = setResult(t, sibling.id, winFor(sibling));
    const follow = t.matches.find((m) => m.id === first.nextMatchId) as Tournament['matches'][number];
    // Schiri zählt im Folgespiel schon an …
    t = setLiveSets(t, follow.id, [{ a: follow.pointsPerSet, b: 5 }]);
    expect(t.matches.find((m) => m.id === follow.id)?.liveSets).toHaveLength(1);
    // … dann wird das Vorspiel gedreht: der Zwischenstand gehört niemandem mehr.
    t = setResult(t, first.id, winFor(first).map((x) => ({ a: x.b, b: x.a })));
    expect(t.matches.find((m) => m.id === follow.id)?.liveSets).toEqual([]);
  });

  it('weigert sich bei bereits gewerteten Spielen', () => {
    let t = performDraw(withPlayers(NAMES.slice(0, 8)), 8);
    const m = t.matches[0];
    t = setResult(t, m.id, winFor(m));
    expect(() => setLiveSets(t, m.id, [{ a: 12, b: 7 }])).toThrow(/schon gewertet/);
  });

  it('setzt in der Trostrunde nur einen Gewinnsatz voraus', () => {
    let t = performDraw({ ...withPlayers(NAMES.slice(0, 8)), settings: { ...createTournament().settings } }, 4);
    const rounds = t.matches.filter((m) => m.tree === 'haupt');
    const firstRound = Math.min(...rounds.map((m) => m.round));
    for (const m of t.matches.filter((x) => x.tree === 'haupt' && x.round === firstRound)) {
      t = setResult(t, m.id, winFor(m));
    }
    const trost = t.matches.find((m) => m.tree === 'trost' && m.a.playerId && m.b.playerId) as Tournament['matches'][number];
    expect(trost.setsToWin).toBe(1);
    // Ein einzelner Satz entscheidet sofort – setLiveSets wertet direkt.
    t = setLiveSets(t, trost.id, [{ a: 12, b: 6 }]);
    expect(t.matches.find((m) => m.id === trost.id)?.outcome).toBe('gespielt');
  });
});
