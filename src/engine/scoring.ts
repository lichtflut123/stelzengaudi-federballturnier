import type { Match, ScoringRules, SetScore } from './types';

export interface Validation {
  ok: boolean;
  errors: string[];
}

function ok(): Validation {
  return { ok: true, errors: [] };
}

/** Maximale Anzahl Sätze eines Spiels (Best-of). */
export function maxSets(rules: ScoringRules): number {
  return rules.setsToWin * 2 - 1;
}

/**
 * Wirksame Obergrenze. Eine Obergrenze unterhalb der Satzlänge wäre
 * widersprüchlich (kein Ergebnis wäre gültig) und gilt deshalb als "keine".
 */
export function effectiveCap(rules: ScoringRules, target = rules.pointsPerSet): number {
  if (!Number.isFinite(rules.cap) || rules.cap <= 0) return Infinity;
  if (rules.cap < target) return Infinity;
  return rules.cap;
}

function plural(count: number): string {
  return count === 1 ? '1 Punkt' : `${count} Punkte`;
}

/** Dativ: „bei 11 Punkten", aber „bei 1 Punkt". */
function pluralDativ(count: number): string {
  return count === 1 ? '1 Punkt' : `${count} Punkten`;
}

/**
 * Prüft einen einzelnen Satz. `target` ist die Punktzahl dieses Spiels –
 * ab dem Halbfinale wird auf eine höhere Zahl gespielt als davor.
 */
export function validateSet(set: SetScore, rules: ScoringRules, target = rules.pointsPerSet): Validation {
  if (!set || typeof set !== 'object') {
    return { ok: false, errors: ['Kein gültiges Satzergebnis.'] };
  }
  const { a, b } = set;
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return { ok: false, errors: ['Punkte müssen ganze Zahlen ab 0 sein.'] };
  }
  if (a === b) {
    return { ok: false, errors: ['Ein Satz kann nicht unentschieden enden.'] };
  }
  if (rules.freeScoring) return ok();

  const errors: string[] = [];
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const goal = Math.max(1, Math.floor(target) || 1);
  const cap = effectiveCap(rules, goal);
  const atCap = Number.isFinite(cap) && hi === cap;

  if (hi < goal) {
    errors.push(`Der Satzgewinner braucht mindestens ${plural(goal)}.`);
    return { ok: false, errors };
  }
  if (hi > cap) {
    errors.push(`Mehr als ${plural(cap)} sind nicht möglich.`);
    return { ok: false, errors };
  }

  if (!rules.winByTwo) {
    if (hi > goal) errors.push(`Ohne Zwei-Punkte-Regel endet der Satz bei genau ${goal}.`);
    return { ok: errors.length === 0, errors };
  }

  if (hi === goal) {
    // Am Zielwert reichen zwei Punkte Vorsprung – außer der Zielwert ist
    // zugleich die Obergrenze, dann endet der Satz dort in jedem Fall.
    if (hi - lo < 2 && !atCap) {
      errors.push(`Bei ${pluralDativ(lo)} des Gegners muss weitergespielt werden (zwei Punkte Vorsprung).`);
    }
  } else if (atCap) {
    // In der Verlängerung bis zur Obergrenze: dort entscheidet ein Punkt.
    if (hi - lo > 2) {
      errors.push(`Bei ${pluralDativ(cap)} kann der Vorsprung höchstens zwei Punkte betragen.`);
    }
  } else if (hi - lo !== 2) {
    errors.push('In der Verlängerung müssen genau zwei Punkte Vorsprung stehen.');
  }
  return { ok: errors.length === 0, errors };
}

export interface SetTally {
  setsA: number;
  setsB: number;
  pointsA: number;
  pointsB: number;
}

/** Zählt Sätze und Punkte einer Satzliste. */
export function tallySets(sets: readonly SetScore[]): SetTally {
  let setsA = 0;
  let setsB = 0;
  let pointsA = 0;
  let pointsB = 0;
  for (const s of sets) {
    // Unbrauchbare Sätze werden übersprungen, nicht umgedeutet.
    if (!s || typeof s !== 'object' || !Number.isFinite(s.a) || !Number.isFinite(s.b)) continue;
    const a = s.a;
    const b = s.b;
    pointsA += a;
    pointsB += b;
    if (a > b) setsA += 1;
    else if (b > a) setsB += 1;
  }
  return { setsA, setsB, pointsA, pointsB };
}

/** Prüft ein komplettes Ergebnis (alle Sätze und ihre Anzahl). */
export function validateResult(
  sets: readonly SetScore[],
  rules: ScoringRules,
  target = rules.pointsPerSet,
): Validation {
  const errors: string[] = [];
  if (!Array.isArray(sets) || sets.length === 0) {
    return { ok: false, errors: ['Es wurde kein Satz eingetragen.'] };
  }
  const limit = maxSets(rules);
  if (sets.length > limit) {
    errors.push(limit === 1 ? 'Es ist nur ein Satz möglich.' : `Es sind höchstens ${limit} Sätze möglich.`);
  }
  // Satznummer nur nennen, wenn es überhaupt mehrere Sätze gibt.
  const numbered = sets.length > 1;
  let allValid = true;
  sets.forEach((set, i) => {
    const res = validateSet(set, rules, target);
    if (!res.ok) allValid = false;
    for (const e of res.errors) errors.push(numbered ? `Satz ${i + 1}: ${e}` : e);
  });

  // Nach der Entscheidung wird nicht weitergespielt. Diese Prüfung nur,
  // wenn die Sätze für sich genommen gültig sind – sonst kommen zwei
  // Meldungen für dieselbe Ursache.
  let a = 0;
  let b = 0;
  for (let i = 0; allValid && i < sets.length; i++) {
    if (a >= rules.setsToWin || b >= rules.setsToWin) {
      errors.push(`Satz ${i + 1}: Das Spiel war bereits entschieden.`);
      break;
    }
    const s = sets[i];
    if (!s) continue;
    if (s.a > s.b) a += 1;
    else if (s.b > s.a) b += 1;
  }
  if (a < rules.setsToWin && b < rules.setsToWin) {
    errors.push(
      rules.setsToWin === 1
        ? 'Noch kein Sieger: ein gewonnener Satz ist nötig.'
        : `Noch kein Sieger: ${rules.setsToWin} gewonnene Sätze sind nötig.`,
    );
  }
  return { ok: errors.length === 0, errors };
}

/** 'a' | 'b' | null – wer nach Sätzen gewonnen hat. */
export function resultWinnerSide(sets: readonly SetScore[], rules: ScoringRules): 'a' | 'b' | null {
  const { setsA, setsB } = tallySets(sets);
  if (setsA >= rules.setsToWin && setsA > setsB) return 'a';
  if (setsB >= rules.setsToWin && setsB > setsA) return 'b';
  return null;
}

/** Kurzform des Ergebnisses, z.B. "21:18, 19:21, 21:15". */
export function formatScore(match: Match): string {
  if (match.outcome === 'kampflos') return 'kampflos';
  if (!Array.isArray(match.sets) || match.sets.length === 0) return '';
  return match.sets.map((s) => `${s.a}:${s.b}`).join(', ');
}

/** Gewonnene Sätze einer Seite, für die Anzeige. */
export function setsWonBy(match: Match, side: 'a' | 'b'): number {
  const t = tallySets(match.sets);
  return side === 'a' ? t.setsA : t.setsB;
}
