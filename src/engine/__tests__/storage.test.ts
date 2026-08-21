import { beforeEach, describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  clearStorage,
  exportJson,
  importJson,
  loadTournament,
  migrate,
  saveTournament,
} from '../storage';
import { createPlayer, createTournament, performDraw } from '../tournament';
import { recompute } from '../tournament';

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length(): number { return this.data.size; }
  clear(): void { this.data.clear(); }
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null; }
  removeItem(key: string): void { this.data.delete(key); }
  setItem(key: string, value: string): void { this.data.set(key, value); }
}

function useStorage(value: unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

beforeEach(() => useStorage(new MemoryStorage()));

function sample() {
  const base = createTournament();
  const players = ['Anna', 'Ben', 'Carla', 'David', 'Emil'].map((n) => createPlayer(n, n === 'Anna'));
  return performDraw({ ...base, players }, 77);
}

describe('Speichern & Laden', () => {
  it('speichert und lädt verlustfrei', () => {
    const t = sample();
    expect(saveTournament(t)).toBe('ok');
    const loaded = loadTournament();
    expect(loaded?.matches).toHaveLength(t.matches.length);
    expect(loaded?.players.map((p) => p.name)).toEqual(t.players.map((p) => p.name));
    expect(loaded?.matches.map((m) => m.number)).toEqual(t.matches.map((m) => m.number));
  });

  it('liefert null, wenn nichts gespeichert ist', () => {
    expect(loadTournament()).toBeNull();
  });

  it('überlebt kaputte Daten im Speicher', () => {
    localStorage.setItem(STORAGE_KEY, '{kein json');
    expect(loadTournament()).toBeNull();
  });

  it('löscht den Speicher', () => {
    saveTournament(sample());
    clearStorage();
    expect(loadTournament()).toBeNull();
  });

  it('meldet gesperrten Speicher', () => {
    useStorage(undefined);
    expect(saveTournament(sample())).toBe('gesperrt');
    expect(loadTournament()).toBeNull();
  });

  it('meldet vollen Speicher', () => {
    const full = new MemoryStorage();
    full.setItem = () => {
      const e = new Error('voll');
      e.name = 'QuotaExceededError';
      throw e;
    };
    useStorage(full);
    expect(saveTournament(sample())).toBe('voll');
  });
});

describe('Export & Import', () => {
  it('macht einen Rundlauf ohne Verlust', () => {
    const t = sample();
    const imported = importJson(exportJson(t));
    expect(imported.matches).toHaveLength(t.matches.length);
    expect(imported.players.map((p) => p.name)).toEqual(t.players.map((p) => p.name));
    expect(imported.settings).toEqual(t.settings);
  });

  it('meldet unlesbare und fremde Dateien verständlich', () => {
    expect(() => importJson('nicht json')).toThrow(/lässt sich nicht lesen/);
    expect(() => importJson('[1,2,3]')).toThrow(/Turnier/);
    expect(() => importJson('"text"')).toThrow(/Turnier/);
    expect(() => importJson('null')).toThrow(/Turnier/);
  });

  it('lehnt zu große Dateien ab', () => {
    expect(() => importJson('x'.repeat(5_000_001))).toThrow(/zu groß/);
  });
});

describe('migrate – feindliche Daten', () => {
  it('füllt fehlende Felder auf', () => {
    const t = migrate({ players: [{ id: 'p1', name: 'Anna', isChampion: false }] });
    expect(t?.settings.scoring.pointsPerSet).toBe(12);
    expect(t?.settings.scoring.endgamePointsPerSet).toBe(21);
    expect(t?.matches).toEqual([]);
  });

  it('verwirft kaputte Listeneinträge, statt zu werfen', () => {
    for (const raw of [
      { players: [null], matches: [] },
      { players: [], matches: [null] },
      { players: [], matches: ['x'] },
      { players: [], matches: [{ id: 'm1', a: 'boom', b: 'boom' }] },
      { players: [], matches: [{ id: 'm1', a: {}, b: {}, sets: [null, 3] }] },
      { players: [{ id: 'p', name: 42 }], matches: [] },
    ]) {
      expect(() => migrate(raw)).not.toThrow();
      const t = migrate(raw);
      expect(t).not.toBeNull();
      expect(() => recompute(t as NonNullable<typeof t>)).not.toThrow();
    }
  });

  it('klemmt unsinnige Zahlen statt sie zu übernehmen', () => {
    const t = migrate({
      players: [],
      settings: { courts: 100000, scoring: { pointsPerSet: -5, cap: 9999, setsToWin: 99 } },
    });
    expect(t?.settings.courts).toBeLessThanOrEqual(12);
    expect(t?.settings.scoring.pointsPerSet).toBeGreaterThanOrEqual(1);
    expect(t?.settings.scoring.cap).toBeLessThanOrEqual(99);
    expect([1, 2]).toContain(t?.settings.scoring.setsToWin);
  });

  it('begrenzt manipulierte Rundennummern – sonst hängt die Neuberechnung', () => {
    const raw = {
      players: [{ id: 'p1', name: 'Anna', isChampion: false }],
      matches: Array.from({ length: 4 }, (_, i) => ({
        id: `m${i}`,
        round: 1e15,
        a: { playerId: 'p1', source: '', rank: null },
        b: { playerId: null, source: '', rank: null },
        sets: [],
      })),
    };
    const t = migrate(raw);
    expect(t?.matches.every((m) => m.round <= 4)).toBe(true);
    const started = Date.now();
    recompute(t as NonNullable<typeof t>);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('entfernt Verweise auf unbekannte Personen', () => {
    const t = migrate({
      players: [{ id: 'p1', name: 'Anna', isChampion: false }],
      matches: [
        {
          id: 'm1',
          a: { playerId: 'p1', source: '', rank: null },
          b: { playerId: 'geist', source: '', rank: null },
          winnerId: 'geist',
          outcome: 'gespielt',
          sets: [{ a: 21, b: 3 }],
        },
      ],
    });
    expect(t?.matches[0].b.playerId).toBeNull();
    expect(t?.matches[0].winnerId).toBeNull();
    expect(t?.matches[0].outcome).toBe('offen');
  });

  it('kappt Verweise auf sich selbst und auf unbekannte Spiele', () => {
    const t = migrate({
      players: [],
      matches: [{ id: 'm1', a: {}, b: {}, nextMatchId: 'm1', nextSlot: 'a' }],
    });
    expect(t?.matches[0].nextMatchId).toBeNull();
  });

  it('lässt keine gefährlichen Schlüssel durch', () => {
    const t = migrate(JSON.parse('{"players":[],"settings":{"__proto__":{"boom":true},"courts":3}}'));
    expect(t?.settings.courts).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(t?.settings ?? {}, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).boom).toBeUndefined();
  });

  it('lehnt offensichtlichen Unsinn ab', () => {
    expect(migrate(null)).toBeNull();
    expect(migrate('text')).toBeNull();
    expect(migrate([1, 2])).toBeNull();
  });
});

describe('Alt-Schema ohne Satzzahl je Spiel', () => {
  it('übernimmt die alte globale Zählweise für vorhandene Spiele', () => {
    // Ein Stand von vor der Trostrunden-Verkürzung: global 1 Gewinnsatz,
    // Spiele ohne eigenes setsToWin-Feld.
    const alt = {
      version: 3,
      players: [
        { id: 'p1', name: 'Anna', isChampion: false },
        { id: 'p2', name: 'Ben', isChampion: false },
      ],
      settings: { scoring: { setsToWin: 1, pointsPerSet: 21 } },
      matches: [
        {
          id: 'm1',
          phase: 'hauptrunde',
          tree: 'haupt',
          label: 'Finale',
          half: 'mitte',
          round: 1,
          a: { playerId: 'p1', source: '', rank: null },
          b: { playerId: 'p2', source: '', rank: null },
          sets: [{ a: 21, b: 15 }],
          outcome: 'gespielt',
          winnerId: 'p1',
          resultFor: ['p1', 'p2'],
        },
        {
          id: 'm2',
          phase: 'hauptrunde',
          tree: 'trost',
          label: 'Trostfinale',
          half: 'mitte',
          round: 1,
          a: { playerId: 'p1', source: '', rank: null },
          b: { playerId: 'p2', source: '', rank: null },
          sets: [],
          outcome: 'offen',
          winnerId: null,
        },
      ],
    };
    const t = migrate(alt);
    expect(t).not.toBeNull();
    // Beide Spiele behalten die alte globale Zählweise (1 Satz), das
    // eingetragene Ein-Satz-Ergebnis bleibt gültig.
    expect(t?.matches.find((m) => m.id === 'm1')?.setsToWin).toBe(1);
    expect(t?.matches.find((m) => m.id === 'm2')?.setsToWin).toBe(1);
    expect(t?.matches.find((m) => m.id === 'm1')?.winnerId).toBe('p1');
  });
});
