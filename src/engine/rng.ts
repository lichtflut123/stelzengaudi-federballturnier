/**
 * Deterministischer Zufallsgenerator (mulberry32).
 * Gleicher Seed => gleiche Auslosung. Das macht jede Auslosung nachvollziehbar
 * und die Tests reproduzierbar.
 */
export interface Rng {
  /** Zufallszahl in [0, 1). */
  next(): number;
  /** Ganzzahl in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Neue, gemischte Kopie des Arrays (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[];
  /** Zufälliges Element (wirft bei leerem Array). */
  pick<T>(items: readonly T[]): T;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (maxExclusive: number): number => {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 0) return 0;
    return Math.floor(next() * maxExclusive) % maxExclusive;
  };
  return {
    next,
    int,
    shuffle<T>(items: readonly T[]): T[] {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    },
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('pick() auf leerer Liste');
      return items[int(items.length)];
    },
  };
}

/** Neuer, zufälliger Seed für eine frische Auslosung. */
export function randomSeed(): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  if (g.crypto && typeof g.crypto.getRandomValues === 'function') {
    return g.crypto.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}
