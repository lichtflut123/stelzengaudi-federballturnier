import { useEffect, useRef, useState } from 'react';
import type { Tournament } from './engine/types';
import {
  ensureRow,
  fetchRemote,
  loadSyncConfig,
  saveRemote,
  type SyncConfig,
} from './sync';

/** Alle 3 Sekunden nachsehen, ob jemand anderes etwas eingetragen hat. */
const POLL_MS = 3000;

export type CloudState =
  | 'aus'
  | 'verbinde'
  | 'ok'
  | 'laeuft'
  | 'netz'
  | 'ueberholt';

interface Options {
  tournament: Tournament;
  contentRevision: number;
  adoptRemote: (next: Tournament) => void;
  /** Auf der Claude-Live-Seite bleibt deren eigener Mechanismus zuständig. */
  enabled: boolean;
}

/**
 * Gemeinsamer Live-Stand über den konfigurierten Dienst: Jede inhaltliche
 * Änderung wird hochgeladen, fremde Änderungen werden per Abfrage übernommen.
 * Ein Versionszähler verhindert, dass ein älterer Stand einen neueren
 * überschreibt – wer den Konflikt verliert, bekommt den fremden Stand und
 * einen Hinweis, statt still Daten zu verlieren.
 */
export function useCloud({ tournament, contentRevision, adoptRemote, enabled }: Options): {
  state: CloudState;
  retry: () => void;
} {
  const [state, setState] = useState<CloudState>(enabled ? 'verbinde' : 'aus');
  const config = useRef<SyncConfig | null>(null);
  /** Version des Dienstes, auf der der lokale Stand aufbaut. */
  const rev = useRef(0);
  /** Inhaltszählung, die bereits hochgeladen (oder übernommen) ist. */
  const synced = useRef(contentRevision);
  const busy = useRef(false);
  const current = useRef(tournament);
  current.current = tournament;

  // Verbindung aufbauen: Konfiguration laden, Zeile anlegen, Stand übernehmen.
  useEffect(() => {
    if (!enabled) {
      setState('aus');
      return;
    }
    let active = true;
    void (async () => {
      const cfg = await loadSyncConfig();
      if (!active) return;
      if (!cfg) {
        setState('aus');
        return;
      }
      config.current = cfg;
      const remote = await ensureRow(cfg, current.current);
      if (!active) return;
      if (!remote) {
        setState('netz');
        return;
      }
      rev.current = remote.rev;
      synced.current = contentRevision;
      adoptRemote(remote.tournament);
      setState('ok');
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Eigene Änderungen hochladen – mit Versionsprüfung. Im Zustand „netz"
  // stößt dieser Effekt nichts an: sonst liefe nach jedem Fehlschlag sofort
  // der nächste Versuch (der Fehlschlag ändert den Zustand, der Zustand
  // triggert den Effekt – eine enge Schleife, die den Dienst hämmert).
  // Den erneuten Versuch übernehmen der 5-Sekunden-Zähler unten und der
  // Knopf „Jetzt versuchen".
  useEffect(() => {
    const cfg = config.current;
    if (!cfg || state === 'aus' || state === 'verbinde' || state === 'netz') return;
    if (contentRevision === synced.current || busy.current) return;
    busy.current = true;
    setState('laeuft');
    const goal = contentRevision;
    void saveRemote(cfg, current.current, rev.current).then((result) => {
      busy.current = false;
      if (result.ok) {
        rev.current = result.rev;
        synced.current = goal;
        setState('ok');
        return;
      }
      if (result.reason === 'konflikt') {
        // Jemand anderes war schneller: dessen Stand gilt, die eigene
        // Eingabe muss noch einmal gemacht werden – aber sichtbar, nicht still.
        if (result.remote) {
          rev.current = result.remote.rev;
          synced.current = goal;
          adoptRemote(result.remote.tournament);
        }
        setState('ueberholt');
        setTimeout(() => setState((s) => (s === 'ueberholt' ? 'ok' : s)), 6000);
        return;
      }
      setState('netz');
    });
  }, [contentRevision, state, adoptRemote]);

  // Bei Netzproblemen mit Abstand erneut versuchen.
  useEffect(() => {
    if (state !== 'netz') return;
    const timer = setTimeout(() => {
      synced.current = synced.current - 0; // keine Änderung – nur erneut anstoßen
      setState('ok');
    }, 5000);
    return () => clearTimeout(timer);
  }, [state]);

  // Regelmäßig nach fremden Änderungen sehen.
  useEffect(() => {
    const cfg = config.current;
    if (!cfg || state === 'aus' || state === 'verbinde') return;
    const timer = setInterval(() => {
      if (busy.current) return;
      // Solange eigene Änderungen ausstehen, nichts übernehmen –
      // der Versionsvergleich beim Hochladen klärt das sauberer.
      if (contentRevision !== synced.current) return;
      void fetchRemote(cfg).then((remote) => {
        if (!remote || remote.rev <= rev.current) return;
        rev.current = remote.rev;
        adoptRemote(remote.tournament);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, contentRevision, adoptRemote]);

  const retry = (): void => {
    if (state === 'netz') setState('ok');
  };

  return { state, retry };
}
