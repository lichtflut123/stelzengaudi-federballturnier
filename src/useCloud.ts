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
  /** Aktuelle Inhaltszählung – für Abschlüsse asynchroner Abläufe. */
  const content = useRef(contentRevision);
  content.current = contentRevision;
  /** Steht die Verbindung (Zeile gelesen oder angelegt)? */
  const connected = useRef(false);
  const connecting = useRef(false);
  const alive = useRef(true);

  /**
   * Verbindungsaufbau: Konfiguration laden, Zeile lesen oder anlegen, Stand
   * übernehmen. Läuft nicht nur beim Start, sondern nach jedem Fehlschlag
   * erneut (5-Sekunden-Zähler, Knopf „Jetzt versuchen") – sonst bliebe die
   * App für immer unverbunden und das Live-Banner wäre gelogen. Ersetzt der
   * fremde Stand dabei lokale Eingaben, wird das über „ueberholt" angezeigt,
   * nicht verschwiegen.
   */
  const connect = async (): Promise<void> => {
    if (connecting.current) return;
    connecting.current = true;
    try {
      if (!config.current) {
        const cfg = await loadSyncConfig();
        if (!alive.current) return;
        if (!cfg) {
          setState('aus');
          return;
        }
        config.current = cfg;
      }
      const remote = await ensureRow(config.current, current.current);
      if (!alive.current) return;
      if (!remote) {
        setState('netz');
        return;
      }
      rev.current = remote.rev;
      const replaced =
        content.current !== synced.current &&
        JSON.stringify(remote.tournament) !== JSON.stringify(current.current);
      synced.current = content.current;
      connected.current = true;
      adoptRemote(remote.tournament);
      if (replaced) {
        setState('ueberholt');
        setTimeout(() => setState((s) => (s === 'ueberholt' ? 'ok' : s)), 6000);
      } else {
        setState('ok');
      }
    } finally {
      connecting.current = false;
    }
  };

  /** Nächster Versuch nach „netz": erst verbinden, dann wieder hochladen. */
  const reattempt = (): void => {
    if (!connected.current) {
      void connect();
      return;
    }
    setState('ok'); // stößt den Upload-Effekt wieder an
  };

  useEffect(() => {
    if (!enabled) {
      setState('aus');
      return;
    }
    alive.current = true;
    void connect();
    return () => {
      alive.current = false;
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
        if (!result.remote) {
          // Die Zeile ist weg oder nicht lesbar: wie ein Netzproblem
          // behandeln. Der nächste Versuch läuft über den Verbindungsaufbau
          // und legt die Zeile notfalls neu an – mit dem lokalen Stand.
          connected.current = false;
          setState('netz');
          return;
        }
        // Jemand anderes war schneller: dessen Stand gilt, die eigene
        // Eingabe muss noch einmal gemacht werden – aber sichtbar, nicht still.
        rev.current = result.remote.rev;
        synced.current = goal;
        adoptRemote(result.remote.tournament);
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
    const timer = setTimeout(reattempt, 5000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Regelmäßig nach fremden Änderungen sehen.
  useEffect(() => {
    const cfg = config.current;
    if (!cfg || state === 'aus' || state === 'verbinde') return;
    const timer = setInterval(() => {
      if (busy.current || !connected.current) return;
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
    if (state === 'netz') reattempt();
  };

  return { state, retry };
}
