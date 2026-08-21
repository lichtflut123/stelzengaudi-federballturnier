import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';

describe('createRng', () => {
  it('liefert bei gleichem Seed die gleiche Folge', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(Array.from({ length: 30 }, () => a.next())).toEqual(Array.from({ length: 30 }, () => b.next()));
  });

  it('liefert bei anderem Seed eine andere Folge', () => {
    const a = createRng(1);
    const b = createRng(2);
    expect(Array.from({ length: 30 }, () => a.next())).not.toEqual(Array.from({ length: 30 }, () => b.next()));
  });

  it('bleibt mit int() im gültigen Bereich', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.int(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
    expect(rng.int(0)).toBe(0);
    expect(rng.int(-3)).toBe(0);
  });

  it('shuffle behält alle Elemente und lässt das Original unberührt', () => {
    const rng = createRng(9);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = rng.shuffle(input);
    expect(out.slice().sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('mischt gleichmäßig – jede Position kommt vor', () => {
    const rng = createRng(3);
    const positions = new Map<number, Set<number>>();
    for (let i = 0; i < 2000; i++) {
      rng.shuffle([0, 1, 2, 3]).forEach((value, index) => {
        const set = positions.get(value) ?? new Set<number>();
        set.add(index);
        positions.set(value, set);
      });
    }
    for (const set of positions.values()) expect(set.size).toBe(4);
  });
});
