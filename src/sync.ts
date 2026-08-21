import type { Tournament } from './engine/types';
import { migrate } from './engine/storage';

/**
 * Gemeinsamer Live-Stand über einen Supabase-Dienst – ganz ohne Konto für
 * die Mitspielenden. Alle Geräte lesen und schreiben dieselbe Zeile; ein
 * Versionszähler (`rev`) sorgt dafür, dass niemand versehentlich einen
 * neueren Stand mit einem älteren überschreibt.
 *
 * Die Zugangsdaten liegen in `sync-config.json` neben der App. Fehlt die
 * Datei oder ist sie leer, läuft die App wie gewohnt rein lokal.
 */

export interface SyncConfig {
  url: string;
  anonKey: string;
  /** Zeilen-Id, falls mehrere Turniere denselben Dienst nutzen. */
  rowId: number;
}

export interface RemoteState {
  rev: number;
  tournament: Tournament;
}

export type SyncSaveResult =
  | { ok: true; rev: number }
  | { ok: false; reason: 'konflikt'; remote: RemoteState | null }
  | { ok: false; reason: 'netz' };

let configCache: SyncConfig | null | undefined;

/** Lädt die Sync-Konfiguration genau einmal. `null` = lokaler Betrieb. */
export async function loadSyncConfig(): Promise<SyncConfig | null> {
  if (configCache !== undefined) return configCache;
  try {
    const response = await fetch('./sync-config.json', { cache: 'no-store' });
    if (!response.ok) {
      configCache = null;
      return null;
    }
    const raw: unknown = await response.json();
    if (
      typeof raw === 'object' &&
      raw !== null &&
      typeof (raw as { url?: unknown }).url === 'string' &&
      (raw as { url: string }).url.startsWith('https://') &&
      typeof (raw as { anonKey?: unknown }).anonKey === 'string' &&
      (raw as { anonKey: string }).anonKey.length > 0
    ) {
      const row = (raw as { rowId?: unknown }).rowId;
      configCache = {
        url: (raw as { url: string }).url.replace(/\/+$/, ''),
        anonKey: (raw as { anonKey: string }).anonKey,
        rowId: typeof row === 'number' && Number.isInteger(row) && row > 0 ? row : 1,
      };
    } else {
      configCache = null;
    }
  } catch {
    configCache = null;
  }
  return configCache;
}

/** Nur für Tests: erzwingt ein Neuladen der Konfiguration. */
export function resetSyncConfig(): void {
  configCache = undefined;
}

function headers(config: SyncConfig): Record<string, string> {
  return {
    apikey: config.anonKey,
    Authorization: `Bearer ${config.anonKey}`,
    'Content-Type': 'application/json',
  };
}

function endpoint(config: SyncConfig): string {
  return `${config.url}/rest/v1/turnier`;
}

function parseRow(raw: unknown): RemoteState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rev = (raw as { rev?: unknown }).rev;
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) return null;
  const tournament = migrate((raw as { state?: unknown }).state);
  if (!tournament) return null;
  return { rev, tournament };
}

/** Holt den aktuellen Stand. `null` = Zeile fehlt noch oder Netzproblem. */
export async function fetchRemote(config: SyncConfig): Promise<RemoteState | null> {
  try {
    const response = await fetch(
      `${endpoint(config)}?id=eq.${config.rowId}&select=rev,state&limit=1`,
      { headers: headers(config), cache: 'no-store' },
    );
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return parseRow(rows[0]);
  } catch {
    return null;
  }
}

/**
 * Schreibt den Stand, aber nur, wenn seit dem Lesen niemand anderes
 * geschrieben hat (Vergleich über `rev`). Bei einem Konflikt kommt der
 * fremde Stand zurück, damit die Änderung darauf neu aufgesetzt werden kann.
 */
export async function saveRemote(
  config: SyncConfig,
  tournament: Tournament,
  expectedRev: number,
): Promise<SyncSaveResult> {
  try {
    const response = await fetch(
      `${endpoint(config)}?id=eq.${config.rowId}&rev=eq.${expectedRev}`,
      {
        method: 'PATCH',
        headers: { ...headers(config), Prefer: 'return=representation' },
        body: JSON.stringify({ rev: expectedRev + 1, state: tournament }),
      },
    );
    if (!response.ok) return { ok: false, reason: 'netz' };
    const rows: unknown = await response.json();
    if (Array.isArray(rows) && rows.length > 0) {
      return { ok: true, rev: expectedRev + 1 };
    }
    // Niemand getroffen: jemand anderes war schneller (oder die Zeile fehlt).
    return { ok: false, reason: 'konflikt', remote: await fetchRemote(config) };
  } catch {
    return { ok: false, reason: 'netz' };
  }
}

/** Legt die Zeile beim allerersten Start an, falls sie noch fehlt. */
export async function ensureRow(config: SyncConfig, tournament: Tournament): Promise<RemoteState | null> {
  const existing = await fetchRemote(config);
  if (existing) return existing;
  try {
    const response = await fetch(endpoint(config), {
      method: 'POST',
      headers: { ...headers(config), Prefer: 'return=representation' },
      body: JSON.stringify({ id: config.rowId, rev: 1, state: tournament }),
    });
    if (!response.ok) {
      // Vielleicht hat sie gerade jemand anderes angelegt.
      return fetchRemote(config);
    }
    const rows: unknown = await response.json();
    if (Array.isArray(rows) && rows.length > 0) {
      const parsed = parseRow(rows[0]);
      if (parsed) return parsed;
    }
    return fetchRemote(config);
  } catch {
    return null;
  }
}
