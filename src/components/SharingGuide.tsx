import { useState } from 'react';
import { isLivePage } from '../live';

/**
 * Anleitung zum Teilen – zum Aufklappen, damit die Vorbereitung
 * auf dem Handy nicht endlos lang wird.
 */
export function SharingGuide() {
  const [open, setOpen] = useState(false);
  const live = isLivePage();

  return (
    <section className="card no-print">
      <button
        className="btn btn--ghost guide__toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        📖 Anleitung: Teilen mit allen anderen {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="guide__body">
          <h3>So sehen alle denselben Stand – und jeder kann eintragen</h3>
          <ol className="guide__steps">
            <li>
              <strong>Link verschicken:</strong> Die Web-Adresse dieser Seite in eure
              WhatsApp-Gruppe stellen. Öffnen geht in jedem Browser – ohne App, ohne Konto,
              ohne Anmeldung.
            </li>
            <li>
              <strong>Jeder darf alles:</strong> Wer den Link hat, kann Ergebnisse eintragen,
              Punkte zählen und den Spielplan sehen. Es gibt bewusst keinen Schutz – ihr seid
              eine Runde Freunde, kein Verband.
            </li>
            <li>
              <strong>Aktualisierung:</strong> Jede Eintragung geht sofort an alle; fremde
              Änderungen erscheinen von selbst binnen weniger Sekunden. Tragen zwei gleichzeitig
              ein, gewinnt der Schnellere – die andere Person bekommt einen Hinweis und trägt
              einfach noch einmal ein.
            </li>
          </ol>

          <h3>Tipps für den Turnierabend</h3>
          <ul className="guide__steps">
            <li>
              <strong>Schiri-Modus:</strong> Am Feld auf „🏸 Schiri-Modus“ tippen und mitzählen –
              zwei große Knöpfe, ein Punkt pro Tipp. Der Stand geht bei jedem Satzende an alle.
            </li>
            <li>
              <strong>Einlaufmusik:</strong> Steht bei „Jetzt dran“, sobald das Spiel dran ist.
              Abspielen macht ihr über eure Box.
            </li>
            <li>
              <strong>Ohne Netz:</strong> Bricht die Verbindung ab, sagt die App das oben an –
              Eintragen geht weiter, alles wird nachgereicht, sobald wieder Netz da ist. Für den
              Notfall gibt es zusätzlich den Export als Datei und den Ausdruck.
            </li>
            <li>
              <strong>Papier-Reserve:</strong> „Drucken“ oben in der Kopfzeile – der Ausdruck hat
              bei offenen Spielen eine Linie zum Eintragen von Hand.
            </li>
          </ul>

          {live && (
            <p className="muted">
              Hinweis: Diese Ansicht läuft als Claude-Artefakt. Dort trägt nur ein, wer
              Bearbeitungsrecht hat – die Fassung für alle liegt unter der normalen Web-Adresse
              aus der WhatsApp-Gruppe.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
