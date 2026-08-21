import type { Id, Match, Player } from './types';

/**
 * Woher die beiden Plätze eines Spiels ihre Personen beziehen: feste Person,
 * Sieger oder Verlierer eines Quellspiels. Zwei Spiele einer Runde können
 * genau dann dieselbe Person treffen, wenn sich diese Herkünfte überschneiden
 * – etwa wenn ein Halbfinal-Verlierer sowohl das Spiel um Platz 3 als auch
 * sein Trostrundenspiel bestreitet (4-7 Personen).
 */
function participantSources(matches: readonly Match[]): Map<Id, Set<string>> {
  const sources = new Map<Id, Set<string>>(matches.map((m) => [m.id, new Set<string>()]));
  for (const match of matches) {
    const own = sources.get(match.id);
    if (!own) continue;
    for (const side of [match.a, match.b]) {
      if (side.playerId) own.add(`person:${side.playerId}`);
    }
    if (match.nextMatchId) sources.get(match.nextMatchId)?.add(`sieger:${match.id}`);
    if (match.loserNextMatchId) sources.get(match.loserNextMatchId)?.add(`verlierer:${match.id}`);
  }
  // Das Spiel um Platz 3 wird nicht über next/loserNext verdrahtet, sondern
  // in recompute() direkt aus den Halbfinal-Verlierern befüllt.
  const third = matches.find((m) => m.isThirdPlace);
  if (third) {
    const own = sources.get(third.id);
    for (const semi of matches) {
      if (!semi.isThirdPlace && semi.label === 'Halbfinale') own?.add(`verlierer:${semi.id}`);
    }
  }
  return sources;
}

/**
 * Verteilt die Spiele auf Zeitfenster und Felder.
 *
 * Die Runden laufen zwingend nacheinander – ein Spiel kann erst starten,
 * wenn seine Vorspiele durch sind. Innerhalb einer Runde werden die Spiele
 * der Reihe nach in Zeitfenster gepackt; ein Spiel rückt in ein späteres
 * Fenster, wenn im früheren eine Person mitspielen könnte, die dort schon
 * dran ist (gleiche Herkunft, siehe participantSources). Das Spiel um
 * Platz 3 wird vor dem Finale angesetzt.
 */
export function assignSlots(matches: Match[], courts: number): void {
  const perSlot = Math.max(1, Math.min(24, Math.floor(courts) || 1));
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
  const sources = participantSources(matches);
  let slot = 0;

  for (const round of rounds) {
    const inRound = matches
      .filter((m) => m.round === round)
      .sort((a, b) => {
        if (a.isThirdPlace !== b.isThirdPlace) return a.isThirdPlace ? -1 : 1;
        return a.posInRound - b.posInRound;
      });
    const fenster: { belegt: number; herkunft: Set<string> }[] = [];
    for (const match of inRound) {
      const own = sources.get(match.id) ?? new Set<string>();
      let ziel = fenster.find(
        (f) => f.belegt < perSlot && ![...own].some((key) => f.herkunft.has(key)),
      );
      if (!ziel) {
        ziel = { belegt: 0, herkunft: new Set<string>() };
        fenster.push(ziel);
      }
      ziel.belegt += 1;
      for (const key of own) ziel.herkunft.add(key);
      match.slot = slot + fenster.indexOf(ziel) + 1;
      match.court = ziel.belegt;
    }
    slot += fenster.length;
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
