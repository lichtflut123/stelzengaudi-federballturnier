import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRow, fetchRemote, loadSyncConfig, resetSyncConfig, saveRemote } from '../../sync';
import { createPlayer, createTournament } from '../tournament';

const CONFIG = { url: 'https://beispiel.supabase.co', anonKey: 'schluessel', rowId: 1 };

function turnier() {
  const t = createTournament();
  return { ...t, players: [createPlayer('Anna'), createPlayer('Ben')] };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

beforeEach(() => {
  resetSyncConfig();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const fetchMock = (): ReturnType<typeof vi.fn> => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

describe('loadSyncConfig', () => {
  it('liest eine gültige Konfiguration', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ url: 'https://x.supabase.co/', anonKey: 'k' }));
    const cfg = await loadSyncConfig();
    expect(cfg).toEqual({ url: 'https://x.supabase.co', anonKey: 'k', rowId: 1 });
  });

  it('liefert null bei leerer oder kaputter Datei', async () => {
    for (const body of [{}, { url: 'http://unsicher', anonKey: 'k' }, { _hinweis: 'leer' }, null, 'text']) {
      resetSyncConfig();
      fetchMock().mockResolvedValueOnce(jsonResponse(body));
      expect(await loadSyncConfig()).toBeNull();
    }
  });

  it('liefert null, wenn die Datei fehlt oder das Netz streikt', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({}, false));
    expect(await loadSyncConfig()).toBeNull();
    resetSyncConfig();
    fetchMock().mockRejectedValueOnce(new Error('offline'));
    expect(await loadSyncConfig()).toBeNull();
  });

  it('merkt sich das Ergebnis', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse({ url: 'https://x.supabase.co', anonKey: 'k' }));
    await loadSyncConfig();
    await loadSyncConfig();
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });
});

describe('fetchRemote', () => {
  it('holt und prüft den Stand', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse([{ rev: 4, state: turnier() }]));
    const remote = await fetchRemote(CONFIG);
    expect(remote?.rev).toBe(4);
    expect(remote?.tournament.players.map((p) => p.name)).toEqual(['Anna', 'Ben']);
  });

  it('verwirft Unsinn statt abzustürzen', async () => {
    for (const body of [[], [{ rev: 'x', state: {} }], [{ rev: 2, state: 'kaputt' }], 'text']) {
      fetchMock().mockResolvedValueOnce(jsonResponse(body));
      expect(await fetchRemote(CONFIG)).toBeNull();
    }
    fetchMock().mockRejectedValueOnce(new Error('offline'));
    expect(await fetchRemote(CONFIG)).toBeNull();
  });
});

describe('saveRemote', () => {
  it('schreibt mit Versionsprüfung', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse([{ rev: 3 }]));
    const result = await saveRemote(CONFIG, turnier(), 2);
    expect(result).toEqual({ ok: true, rev: 3 });
    const [url, init] = fetchMock().mock.calls[0] as [string, RequestInit];
    expect(url).toContain('rev=eq.2');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string).rev).toBe(3);
  });

  it('meldet einen Konflikt und liefert den fremden Stand mit', async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse([])) // Versionsprüfung traf nichts
      .mockResolvedValueOnce(jsonResponse([{ rev: 7, state: turnier() }]));
    const result = await saveRemote(CONFIG, turnier(), 2);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'konflikt') {
      expect(result.remote?.rev).toBe(7);
    } else {
      throw new Error('Konflikt erwartet');
    }
  });

  it('meldet Netzprobleme als solche', async () => {
    fetchMock().mockRejectedValueOnce(new Error('offline'));
    expect(await saveRemote(CONFIG, turnier(), 1)).toEqual({ ok: false, reason: 'netz' });
    fetchMock().mockResolvedValueOnce(jsonResponse({}, false));
    expect(await saveRemote(CONFIG, turnier(), 1)).toEqual({ ok: false, reason: 'netz' });
  });
});

describe('ensureRow', () => {
  it('nimmt eine vorhandene Zeile', async () => {
    fetchMock().mockResolvedValueOnce(jsonResponse([{ rev: 5, state: turnier() }]));
    const remote = await ensureRow(CONFIG, turnier());
    expect(remote?.rev).toBe(5);
    expect(fetchMock()).toHaveBeenCalledTimes(1);
  });

  it('legt die Zeile beim ersten Start an', async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse([])) // noch keine Zeile
      .mockResolvedValueOnce(jsonResponse([{ rev: 1, state: turnier() }])); // POST-Antwort
    const remote = await ensureRow(CONFIG, turnier());
    expect(remote?.rev).toBe(1);
    const [, init] = fetchMock().mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('POST');
  });

  it('holt die Zeile nach, wenn jemand anderes schneller angelegt hat', async () => {
    fetchMock()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse({}, false)) // POST scheitert (Duplikat)
      .mockResolvedValueOnce(jsonResponse([{ rev: 1, state: turnier() }]));
    const remote = await ensureRow(CONFIG, turnier());
    expect(remote?.rev).toBe(1);
  });
});
