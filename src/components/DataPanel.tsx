import { useRef, useState } from 'react';
import type { Tournament } from '../engine/types';
import { MAX_IMPORT_BYTES, exportJson, importJson } from '../engine/storage';
import { isLivePage, saveFile } from '../live';

interface Props {
  tournament: Tournament;
  readOnly: boolean;
  onImport: (t: Tournament) => void;
  onReset: () => void;
  onNextYear: () => void;
  canStartNextYear: boolean;
}

/** Dateiname ohne Sonderzeichen – manche Browser verwerfen ihn sonst. */
function safeName(title: string): string {
  const safe = (title || 'turnier')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return safe || 'turnier';
}

export function DataPanel({ tournament, readOnly, onImport, onReset, onNextYear, canStartNextYear }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const download = async (): Promise<void> => {
    const json = exportJson(tournament);
    const name = `${safeName(tournament.settings.name)}.json`;
    if (isLivePage()) {
      // Auf der geteilten Seite läuft das Speichern über die Plattform.
      const done = await saveFile(name, json);
      setMessage(
        done
          ? { kind: 'ok', text: 'Datei wurde gespeichert.' }
          : { kind: 'error', text: 'Diese Ansicht darf keine Datei speichern.' },
      );
      return;
    }
    try {
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage({ kind: 'ok', text: 'Datei wurde gespeichert (bei Handys im Ordner „Downloads“).' });
    } catch {
      setMessage({ kind: 'error', text: 'Der Download hat nicht geklappt.' });
    }
  };

  const upload = async (file: File): Promise<void> => {
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Die Datei ist zu groß für ein Turnier.');
      const text = await file.text();
      const imported = importJson(text);
      const busy = tournament.players.length > 0 || tournament.matches.length > 0;
      if (busy && !confirm('Das laufende Turnier wird durch die Datei ersetzt. Fortfahren?')) return;
      onImport(imported);
      setMessage({ kind: 'ok', text: 'Turnier geladen.' });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : 'Import fehlgeschlagen.' });
    }
  };

  return (
    <section className="card no-print">
      <h2>Sichern &amp; übertragen</h2>
      <p className="muted">
        {readOnly
          ? 'Der Stand kommt von der Turnierleitung. Zum Mitnehmen lässt er sich exportieren.'
          : 'Zum Weitergeben die Datei exportieren und auf dem anderen Gerät importieren.'}
      </p>
      <div className="btn-row">
        <button className="btn" type="button" onClick={() => void download()}>
          Exportieren
        </button>
        {!readOnly && (
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>
            Importieren
          </button>
        )}
        {canStartNextYear && !readOnly && (
          <button
            className="btn"
            type="button"
            onClick={() => {
              if (confirm('Neues Turnier mit denselben Personen starten? Der Sieger wird zum Vorjahresgewinner – der alte Spielplan geht verloren (vorher exportieren, falls er bleiben soll).')) {
                onNextYear();
                setMessage(null);
              }
            }}
          >
            Nächstes Jahr vorbereiten
          </button>
        )}
        {!readOnly && (
        <button
          className="btn btn--danger"
          type="button"
          onClick={() => {
            if (confirm('Turnier komplett zurücksetzen? Alle Namen und Ergebnisse gehen verloren.')) {
              onReset();
              setMessage(null);
            }
          }}
        >
          Alles zurücksetzen
        </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
      {message && (
        <div className={`note ${message.kind === 'ok' ? 'note--ok' : 'note--error'}`} role="status">
          {message.text}
        </div>
      )}
    </section>
  );
}
