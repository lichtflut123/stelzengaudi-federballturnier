import { Component, type ReactNode } from 'react';
import { STORAGE_KEY } from '../engine/storage';
import { isLivePage, saveFile } from '../live';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Fängt Fehler beim Rendern ab. Ohne das wäre der ganze Bildschirm weiß –
 * mitten im Turnier der schlechteste denkbare Zustand.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  private rescue = (): void => {
    try {
      // Auf der Live-Seite liegt der Stand nicht im Gerätespeicher, sondern
      // eingebettet in der Seite selbst.
      const embedded = document.getElementById('turnier-state')?.textContent;
      const raw = isLivePage()
        ? (embedded && embedded !== 'null' ? embedded : '{}')
        : (globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}');
      if (isLivePage()) {
        void saveFile('turnier-rettung.json', raw);
        return;
      }
      const blob = new Blob([raw], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'turnier-rettung.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      /* dann eben nicht */
    }
  };

  private hardReset = (): void => {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* egal */
    }
    location.reload();
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="app">
        <section className="card" style={{ marginTop: 40 }}>
          <h1>Da ist etwas schiefgelaufen</h1>
          <p>
            Die Anzeige konnte nicht aufgebaut werden. Der Turnierstand liegt aber noch im
            Speicher dieses Geräts. Am besten zuerst die Daten sichern.
          </p>
          <div className="btn-row">
            <button className="btn btn--primary" type="button" onClick={this.rescue}>
              Daten sichern
            </button>
            <button className="btn" type="button" onClick={() => location.reload()}>
              Neu laden
            </button>
            <button className="btn btn--danger" type="button" onClick={this.hardReset}>
              Zurücksetzen und neu starten
            </button>
          </div>
          <p className="muted" style={{ marginTop: 16 }}>
            Technischer Hinweis: {this.state.error.message}
          </p>
        </section>
      </div>
    );
  }
}
