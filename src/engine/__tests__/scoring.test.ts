import { describe, expect, it } from 'vitest';
import { effectiveCap, formatScore, maxSets, resultWinnerSide, setsWonBy, tallySets, validateResult, validateSet } from '../scoring';
import { defaultSettings } from '../tournament';
import type { Match, ScoringRules } from '../types';

/** Badminton-Standard, wie ihn die Endrunde nutzt. */
const rules = (over: Partial<ScoringRules> = {}): ScoringRules => ({
  ...defaultSettings().scoring,
  setsToWin: 1,
  pointsPerSet: 21,
  endgamePointsPerSet: 21,
  winByTwo: true,
  cap: 30,
  freeScoring: false,
  ...over,
});

describe('validateSet – Standardregeln 21/30', () => {
  const r = rules();
  it('nimmt reguläre Sätze an', () => {
    for (const s of [{ a: 21, b: 0 }, { a: 21, b: 15 }, { a: 21, b: 19 }, { a: 22, b: 20 }, { a: 29, b: 27 }, { a: 30, b: 28 }, { a: 30, b: 29 }]) {
      expect(validateSet(s, r), JSON.stringify(s)).toMatchObject({ ok: true });
    }
  });

  it('lehnt ungültige Sätze ab', () => {
    for (const s of [{ a: 21, b: 20 }, { a: 21, b: 21 }, { a: 20, b: 5 }, { a: 23, b: 20 }, { a: 25, b: 20 }, { a: 31, b: 29 }, { a: 30, b: 20 }, { a: 30, b: 0 }, { a: -1, b: 21 }, { a: 21.5, b: 3 }]) {
      expect(validateSet(s, r), JSON.stringify(s)).toMatchObject({ ok: false });
    }
  });

  it('erlaubt an der Obergrenze höchstens zwei Punkte Vorsprung', () => {
    expect(validateSet({ a: 30, b: 29 }, r).ok).toBe(true);
    expect(validateSet({ a: 30, b: 28 }, r).ok).toBe(true);
    expect(validateSet({ a: 30, b: 27 }, r).ok).toBe(false);
  });
});

describe('validateSet – andere Einstellungen', () => {
  it('ohne Obergrenze läuft die Verlängerung weiter', () => {
    const r = rules({ cap: 0 });
    expect(validateSet({ a: 35, b: 33 }, r).ok).toBe(true);
    expect(validateSet({ a: 40, b: 20 }, r).ok).toBe(false);
    expect(validateSet({ a: 21, b: 20 }, r).ok).toBe(false);
  });

  it('Obergrenze gleich Satzlänge lässt einen Punkt Vorsprung zu', () => {
    const r = rules({ pointsPerSet: 21, cap: 21 });
    expect(validateSet({ a: 21, b: 20 }, r).ok).toBe(true);
    expect(validateSet({ a: 21, b: 5 }, r).ok).toBe(true);
    expect(validateSet({ a: 22, b: 20 }, r).ok).toBe(false);
  });

  it('kürzere Sätze funktionieren', () => {
    const r = rules({ pointsPerSet: 15, cap: 21 });
    expect(validateSet({ a: 15, b: 9 }, r).ok).toBe(true);
    expect(validateSet({ a: 21, b: 20 }, r).ok).toBe(true);
    expect(validateSet({ a: 21, b: 10 }, r).ok).toBe(false);
    expect(validateSet({ a: 14, b: 3 }, r).ok).toBe(false);
  });

  it('ohne Zwei-Punkte-Regel endet der Satz exakt am Zielwert', () => {
    const r = rules({ winByTwo: false, cap: 0 });
    expect(validateSet({ a: 21, b: 20 }, r).ok).toBe(true);
    expect(validateSet({ a: 22, b: 20 }, r).ok).toBe(false);
  });

  it('freie Zählweise lässt jedes Ergebnis mit Sieger zu', () => {
    const r = rules({ freeScoring: true });
    expect(validateSet({ a: 3, b: 1 }, r).ok).toBe(true);
    expect(validateSet({ a: 100, b: 0 }, r).ok).toBe(true);
    expect(validateSet({ a: 3, b: 3 }, r).ok).toBe(false);
  });

  it('eine widersprüchliche Obergrenze wird ignoriert statt alles zu sperren', () => {
    // Obergrenze kleiner als Satzlänge: sonst wäre kein Ergebnis eintragbar.
    const r = rules({ pointsPerSet: 21, cap: 15 });
    expect(effectiveCap(r)).toBe(Infinity);
    expect(validateSet({ a: 21, b: 10 }, r).ok).toBe(true);
    expect(validateSet({ a: 23, b: 21 }, r).ok).toBe(true);
  });

  it('liefert bei freier Zählweise jedes Mal ein frisches Ergebnisobjekt', () => {
    const r = rules({ freeScoring: true });
    const first = validateSet({ a: 3, b: 1 }, r);
    first.errors.push('kaputt');
    expect(validateSet({ a: 4, b: 1 }, r).errors).toEqual([]);
  });
});

describe('Voreinstellung des Turniers', () => {
  const preset = defaultSettings().scoring;

  it('spielt zwei Gewinnsätze bis 12 ohne Obergrenze', () => {
    expect(preset).toMatchObject({ setsToWin: 2, pointsPerSet: 12, endgamePointsPerSet: 21, winByTwo: true, cap: 0 });
  });

  it('verlangt bei 12 zwei Punkte Vorsprung und lässt die Verlängerung offen', () => {
    expect(validateSet({ a: 12, b: 7 }, preset).ok).toBe(true);
    expect(validateSet({ a: 12, b: 11 }, preset).ok).toBe(false);
    expect(validateSet({ a: 14, b: 12 }, preset).ok).toBe(true);
    expect(validateSet({ a: 20, b: 18 }, preset).ok).toBe(true);
    expect(validateSet({ a: 20, b: 15 }, preset).ok).toBe(false);
  });

  it('nutzt ab dem Halbfinale die höhere Punktzahl', () => {
    const ziel = preset.endgamePointsPerSet;
    expect(validateSet({ a: 21, b: 15 }, preset, ziel).ok).toBe(true);
    expect(validateSet({ a: 12, b: 5 }, preset, ziel).ok).toBe(false);
    expect(validateResult([{ a: 21, b: 15 }, { a: 21, b: 19 }], preset, ziel).ok).toBe(true);
  });
});

describe('validateResult', () => {
  it('verlangt die volle Anzahl Satzsiege', () => {
    const bo3 = rules({ setsToWin: 2 });
    expect(validateResult([{ a: 21, b: 10 }], bo3).ok).toBe(false);
    expect(validateResult([{ a: 21, b: 10 }, { a: 21, b: 12 }], bo3).ok).toBe(true);
    expect(validateResult([{ a: 21, b: 10 }, { a: 12, b: 21 }, { a: 21, b: 9 }], bo3).ok).toBe(true);
  });

  it('lehnt Sätze nach der Entscheidung ab', () => {
    const bo3 = rules({ setsToWin: 2 });
    expect(validateResult([{ a: 21, b: 10 }, { a: 21, b: 12 }, { a: 21, b: 9 }], bo3).ok).toBe(false);
  });

  it('lehnt leere Ergebnisse ab', () => {
    expect(validateResult([], rules()).ok).toBe(false);
  });

  it('formuliert die Meldung im Ein-Satz-Modus im Singular', () => {
    const res = validateResult([{ a: 21, b: 10 }, { a: 21, b: 12 }], rules({ setsToWin: 1 }));
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/nur ein Satz/i);
  });

  it('nennt die Satznummer nur bei mehreren Sätzen', () => {
    const single = validateResult([{ a: 21, b: 20 }], rules({ setsToWin: 1 }));
    expect(single.errors.join(' ')).not.toMatch(/Satz 1:/);
    const many = validateResult([{ a: 21, b: 20 }, { a: 21, b: 20 }], rules({ setsToWin: 2 }));
    expect(many.errors.join(' ')).toMatch(/Satz 2:/);
  });

  it('bildet Ein-Punkt-Angaben im Singular', () => {
    const res = validateSet({ a: 2, b: 1 }, rules({ pointsPerSet: 2, cap: 0 }));
    expect(res.errors.join(' ')).toMatch(/Bei 1 Punkt des Gegners/);
    expect(res.errors.join(' ')).not.toMatch(/1 Punkten/);
  });

  it('maxSets passt zur Einstellung', () => {
    expect(maxSets(rules({ setsToWin: 1 }))).toBe(1);
    expect(maxSets(rules({ setsToWin: 2 }))).toBe(3);
  });
});

describe('Auswertung', () => {
  it('zählt Sätze und Punkte', () => {
    expect(tallySets([{ a: 21, b: 18 }, { a: 15, b: 21 }, { a: 21, b: 19 }])).toEqual({
      setsA: 2, setsB: 1, pointsA: 57, pointsB: 58,
    });
  });

  it('bestimmt den Sieger', () => {
    const bo3 = rules({ setsToWin: 2 });
    expect(resultWinnerSide([{ a: 21, b: 18 }, { a: 15, b: 21 }, { a: 21, b: 19 }], bo3)).toBe('a');
    expect(resultWinnerSide([{ a: 21, b: 18 }], bo3)).toBe(null);
  });

  it('überlebt beschädigte Satzlisten', () => {
    const broken = [null, { a: 21, b: 10 }] as unknown as { a: number; b: number }[];
    expect(() => tallySets(broken)).not.toThrow();
    expect(tallySets(broken).setsA).toBe(1);
  });

  it('formatiert Ergebnisse lesbar', () => {
    const base = { sets: [{ a: 21, b: 18 }], outcome: 'gespielt' } as Match;
    expect(formatScore(base)).toBe('21:18');
    expect(formatScore({ ...base, outcome: 'kampflos' } as Match)).toBe('kampflos');
    expect(setsWonBy(base, 'a')).toBe(1);
    expect(setsWonBy(base, 'b')).toBe(0);
  });
});
