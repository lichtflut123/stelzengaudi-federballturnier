import type { Id, Match, Player } from './types';

/**
 * Verteilt die Spiele auf Zeitfenster und Felder.
 *
 * Die Runden laufen zwingend nacheinander – ein Spiel kann erst starten,
 * wenn seine Vorspiele durch sind. Innerhalb einer Runde spielt niemand
 * zweimal, deshalb genügt es, die Runde in Blöcke von `courts` Spielen zu
 * teilen. Das Spiel um Platz 3 wird vor dem Finale angesetzt.
 */
export function assignSlots(matches: Match[], courts: number): void {
  const perSlot = Math.max(1, Math.min(24, Math.floor(courts) || 1));
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  let slot = 0;

  for (const round of rounds) {
    const inRound = matches
      .filter((m) => m.round === round)
      .sort((a, b) => {
        if (a.isThirdPlace !== b.isThirdPlace) return a.isThirdPlace ? -1 : 1;
        return a.posInRound - b.posInRound;
      });
    inRound.forEach((match, index) => {
      match.slot = slot + Math.floor(index / perSlot) + 1;
      match.court = (index % perSlot) + 1;
    });
    slot += Math.ceil(inRound.length / perSlot);
  }
}

/** Vergibt die laufenden Spielnummern in Spielplan-Reihenfolge. */
export function renumber(matches: Match[]): void {
  const ordered = matches.slice().sort(compareForPlan);
  ordered.forEach((match, index) => {
    match.number = index + 1;
  });
}

/** Sortierung des Spielplans: Zeitfenster, dann Feld. */
export function compareForPlan(a: Match, b: Match): number {
  if (a.slot !== b.slot) return a.slot - b.slot;
  if (a.court !== b.court) return a.court - b.court;
  return a.posInRound - b.posInRound;
}

/**
 * Die Spiele, die im aktuellen Zeitfenster anstehen, und die danach.
 * Grundlage für die "Läuft gerade"-Anzeige.
 */
export function currentAndNext(matches: readonly Match[]): { now: Match[]; next: Match[] } {
  const open = matches.filter((m) => m.winnerId === null && m.a.playerId && m.b.playerId);
  if (open.length === 0) return { now: [], next: [] };
  const slots = [...new Set(open.map((m) => m.slot))].sort((a, b) => a - b);
  const now = open.filter((m) => m.slot === slots[0]).sort(compareForPlan);
  const next = slots.length > 1 ? open.filter((m) => m.slot === slots[1]).sort(compareForPlan) : [];
  return { now, next };
}

/** Namens-Nachschlagewerk für die Anzeige. */
export function playerNames(players: readonly Player[]): Map<Id, string> {
  return new Map(players.map((p) => [p.id, p.name.trim() || '(ohne Namen)']));
}
