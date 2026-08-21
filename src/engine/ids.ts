let counter = 0;

/** Kurze, im Dokument eindeutige Id. */
export function newId(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${rand}`;
}

/** Nur für Tests: Zähler zurücksetzen. */
export function resetIdCounter(): void {
  counter = 0;
}
