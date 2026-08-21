import { describe, expect, it } from 'vitest';
import { buildBracket, isEndgame, mainBracketSize, roundLabel, seedOrder } from '../bracket';
import { createRng } from '../rng';
import { defaultSettings } from '../tournament';
import type { Player, ScoringRules } from '../types';

const scoring: ScoringRules = defaultSettings().scoring;

const players = (count: number, championCount = 0): Player[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i + 1}`,
    isChampion: i < championCount,
    song: '',
  }));

const plan = (count: number, champions = 0, seed = 1, over = {}) =>
  buildBracket(players(count, champions), createRng(seed), {
    thirdPlaceMatch: true,
    consolation: true,
    scoring,
    ...over,
  });

describe('mainBracketSize', () => {
  it('rundet auf die nächstkleinere Zweierpotenz ab', () => {
    expect([2, 3, 4, 7, 8, 11, 16, 31, 32].map(mainBracketSize)).toEqual([2, 2, 4, 4, 8, 8, 16, 16, 32]);
  });

  it('bleibt bei Unsinn bei zwei', () => {
    for (const n of [0, -5, Number.NaN, Infinity]) expect(mainBracketSize(n)).toBe(2);
  });
});

describe('seedOrder', () => {
  it('erzeugt die klassische Setzreihenfolge', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('paart Rang r immer mit Rang size+1-r', () => {
    for (const size of [2, 4, 8, 16, 32, 64]) {
      const order = seedOrder(size);
      expect(new Set(order).size).toBe(size);
      for (let i = 0; i < size; i += 2) expect(order[i] + order[i + 1]).toBe(size + 1);
    }
  });
});

describe('roundLabel und isEndgame', () => {
  it('benennt Haupt- und Trostrunden unterschiedlich', () => {
    expect(roundLabel(2, 'haupt')).toBe('Finale');
    expect(roundLabel(4, 'haupt')).toBe('Halbfinale');
    expect(roundLabel(2, 'trost')).toBe('Trostfinale');
    expect(roundLabel(4, 'trost')).toBe('Trost-Halbfinale');
  });

  it('erkennt die Spiele mit erhöhter Punktzahl', () => {
    expect(isEndgame('Halbfinale', 'haupt')).toBe(true);
    expect(isEndgame('Finale', 'haupt')).toBe(true);
    expect(isEndgame('Spiel um Platz 3', 'haupt')).toBe(true);
    expect(isEndgame('Viertelfinale', 'haupt')).toBe(false);
    expect(isEndgame('Trostfinale', 'trost')).toBe(false);
  });
});

describe('Hauptbaum', () => {
  it('braucht bei einer Zweierpotenz keine Vorrunde', () => {
    const p = plan(8, 2, 1, { consolation: false });
    expect(p.playInCount).toBe(0);
    expect(p.mainSize).toBe(8);
    expect(p.matches.filter((m) => m.phase === 'vorrunde')).toHaveLength(0);
    expect(p.matches).toHaveLength(8); // 7 + Spiel um Platz 3
  });

  it('setzt genau so viele Vorrundenspiele an wie nötig', () => {
    for (const n of [3, 5, 6, 7, 9, 11, 13, 17, 23, 31]) {
      const p = plan(n, 0, n, { consolation: false, thirdPlaceMatch: false });
      expect(p.playInCount).toBe(n - mainBracketSize(n));
      expect(p.matches).toHaveLength(n - 1);
    }
  });

  it('lässt jede Person genau einmal starten', () => {
    for (let seed = 0; seed < 30; seed++) {
      const list = players(11, 3);
      const p = buildBracket(list, createRng(seed), { thirdPlaceMatch: true, consolation: true, scoring });
      const starters = p.matches
        .filter((m) => m.tree === 'haupt' && m.round <= (p.playInCount > 0 ? 2 : 1))
        .flatMap((m) => [m.a.playerId, m.b.playerId])
        .filter(Boolean);
      expect(new Set(starters).size).toBe(list.length);
      expect(starters).toHaveLength(list.length);
    }
  });

  it('nimmt Vorjahresgewinner von der Vorrunde aus', () => {
    for (let seed = 0; seed < 40; seed++) {
      const list = players(11, 3);
      const p = buildBracket(list, createRng(seed), { thirdPlaceMatch: false, consolation: false, scoring });
      const inPlayIn = p.matches.filter((m) => m.phase === 'vorrunde').flatMap((m) => [m.a.playerId, m.b.playerId]);
      for (const c of list.filter((x) => x.isChampion)) expect(inPlayIn).not.toContain(c.id);
    }
  });

  it('trennt Vorjahresgewinner im Hauptfeld so weit wie möglich', () => {
    for (const [n, champs] of [[8, 2], [8, 4], [16, 4], [16, 8], [11, 4], [13, 2], [32, 8]] as const) {
      for (let seed = 0; seed < 40; seed++) {
        const list = players(n, champs);
        const p = buildBracket(list, createRng(seed), { thirdPlaceMatch: false, consolation: false, scoring });
        const championIds = new Set(list.filter((x) => x.isChampion).map((x) => x.id));
        const firstRound = Math.min(...p.matches.map((m) => m.round));
        for (const m of p.matches.filter((x) => x.round === firstRound)) {
          const both = championIds.has(m.a.playerId ?? '') && championIds.has(m.b.playerId ?? '');
          expect(both, `n=${n} champs=${champs} seed=${seed}`).toBe(false);
        }
      }
    }
  });

  it('warnt erst, wenn ein frühes Duell wirklich unvermeidbar ist', () => {
    // Zwei Gesetzte in einem Feld für zwei treffen sich im Finale – das ist kein frühes Duell.
    expect(plan(2, 2).warnings.join(' ')).not.toMatch(/Duell/);
    expect(plan(8, 4).warnings.join(' ')).not.toMatch(/Duell/);
    expect(plan(8, 5).warnings.join(' ')).toMatch(/Duell/);
  });

  it('spielt Halbfinale, Finale und Platz 3 auf die höhere Punktzahl', () => {
    const p = plan(8, 0, 3);
    for (const m of p.matches.filter((x) => x.tree === 'haupt')) {
      const expected = isEndgame(m.label, 'haupt') ? scoring.endgamePointsPerSet : scoring.pointsPerSet;
      expect(m.pointsPerSet, m.label).toBe(expected);
    }
  });

  it('verknüpft jede Runde mit der nächsten, ohne Zyklen', () => {
    const p = plan(16, 0, 4, { consolation: false, thirdPlaceMatch: false });
    const byId = new Map(p.matches.map((m) => [m.id, m]));
    const finals = p.matches.filter((m) => !m.nextMatchId);
    expect(finals).toHaveLength(1);
    for (const m of p.matches) {
      if (!m.nextMatchId) continue;
      const target = byId.get(m.nextMatchId);
      expect(target).toBeTruthy();
      expect((target as (typeof p.matches)[number]).round).toBeGreaterThan(m.round);
    }
    const fed = p.matches.filter((m) => m.nextMatchId).map((m) => `${m.nextMatchId}:${m.nextSlot}`);
    expect(new Set(fed).size).toBe(fed.length);
  });

  it('teilt den Hauptbaum in zwei gleich große Hälften mit Finale in der Mitte', () => {
    for (const n of [4, 8, 16, 11, 24]) {
      const p = plan(n, 0, n, { consolation: false, thirdPlaceMatch: false });
      const main = p.matches.filter((m) => m.phase === 'hauptrunde');
      expect(main.filter((m) => m.half === 'links')).toHaveLength(main.filter((m) => m.half === 'rechts').length);
      expect(main.filter((m) => m.half === 'mitte')).toHaveLength(1);
    }
  });

  it('stellt jedes Vorrundenspiel in die Hälfte seines Zielplatzes', () => {
    for (const n of [3, 5, 6, 11, 24]) {
      const p = plan(n, 0, n, { consolation: false, thirdPlaceMatch: false });
      const byId = new Map(p.matches.map((m) => [m.id, m]));
      for (const m of p.matches.filter((x) => x.phase === 'vorrunde')) {
        const target = byId.get(m.nextMatchId as string);
        expect(target).toBeTruthy();
        expect(m.half, `n=${n}`).toBe(target?.half);
      }
    }
  });
});

describe('Trostrunde', () => {
  it('bietet jedem Erstrunden-Verlierer einen Platz', () => {
    for (const n of [4, 5, 8, 11, 12, 16, 17]) {
      const p = plan(n, 0, n);
      const expected = n - mainBracketSize(n) + mainBracketSize(n) / 2;
      expect(p.consolationSize, `n=${n}`).toBe(expected);
      const trost = p.matches.filter((m) => m.tree === 'trost');
      expect(trost).toHaveLength(expected - 1);
    }
  });

  it('schickt genau die Verlierer der ersten Spiele dorthin', () => {
    const p = plan(12, 2, 5);
    const senders = p.matches.filter((m) => m.loserNextMatchId);
    const firstRound = Math.min(...p.matches.filter((m) => m.tree === 'haupt').map((m) => m.round));
    for (const m of senders) {
      expect(m.tree).toBe('haupt');
      expect(m.round).toBeLessThanOrEqual(firstRound + 1);
    }
    // Jeder Trost-Platz wird von genau einem Spiel gespeist.
    const targets = senders.map((m) => `${m.loserNextMatchId}:${m.loserNextSlot}`);
    expect(new Set(targets).size).toBe(targets.length);
    expect(senders).toHaveLength(p.consolationSize);
  });

  it('findet ohne Trostrunde auch statt', () => {
    const p = plan(8, 0, 2, { consolation: false });
    expect(p.matches.some((m) => m.tree === 'trost')).toBe(false);
    expect(p.matches.some((m) => m.loserNextMatchId)).toBe(false);
  });

  it('spielt auf die normale Punktzahl, auch im Trostfinale', () => {
    const p = plan(12, 0, 7);
    for (const m of p.matches.filter((x) => x.tree === 'trost')) {
      expect(m.pointsPerSet).toBe(scoring.pointsPerSet);
    }
  });
});

describe('Rundenzuordnung', () => {
  it('setzt jedes Spiel hinter alle seine Vorspiele', () => {
    for (const n of [4, 5, 8, 11, 12, 16, 24]) {
      const p = plan(n, 1, n);
      const byId = new Map(p.matches.map((m) => [m.id, m]));
      for (const m of p.matches) {
        for (const targetId of [m.nextMatchId, m.loserNextMatchId]) {
          if (!targetId) continue;
          const target = byId.get(targetId);
          expect(target?.round, `n=${n}`).toBeGreaterThan(m.round);
        }
      }
    }
  });
});

describe('Fehlerfälle', () => {
  it('meldet zu wenige Teilnehmer', () => {
    const p = plan(1);
    expect(p.matches).toEqual([]);
    expect(p.warnings).toHaveLength(1);
  });
});
