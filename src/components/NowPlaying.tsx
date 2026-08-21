import type { Id, Match, Tournament } from '../engine/types';
import { currentAndNext } from '../engine/schedule';
import { isFinished, podium } from '../engine/tournament';

interface Props {
  tournament: Tournament;
  names: ReadonlyMap<Id, string>;
  /** Antippen einer Zeile springt zur Spielkarte im Spielplan. */
  onJump: (matchId: Id) => void;
}

function songOf(tournament: Tournament, id: Id | null): string {
  if (!id) return '';
  return tournament.players.find((p) => p.id === id)?.song.trim() ?? '';
}

/** Was gerade auf welchem Feld läuft – die meistgebrauchte Information am Hallenrand. */
export function NowPlaying({ tournament, names, onJump }: Props) {
  const { now, next } = currentAndNext(tournament.matches);
  const places = podium(tournament);

  // Erst wenn wirklich alles gespielt ist – sonst stünde „Turnier beendet"
  // da, während das Trostfinale noch aussteht.
  if (places.length > 0 && isFinished(tournament)) {
    return (
      <section className="card now now--done">
        <h2>Turnier beendet</h2>
        <div className="podium">
          {places.map((p) => (
            <div className="podium__row" key={p.playerId}>
              <span className="podium__medal" aria-hidden="true">
                {['🥇', '🥈', '🥉'][p.place - 1] ?? '🏅'}
              </span>
              <span className="podium__place">{p.place}.</span>
              <span className="podium__name">{names.get(p.playerId) ?? 'Unbekannt'}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (now.length === 0) return null;

  const line = (m: Match): string =>
    `${names.get(m.a.playerId ?? '') ?? '?'} – ${names.get(m.b.playerId ?? '') ?? '?'}`;

  return (
    <section className="card now">
      <h2>Jetzt dran</h2>
      <ul className="now__list">
        {now.map((m) => {
          const songs = ([m.a.playerId, m.b.playerId] as const)
            .map((id) => ({ name: names.get(id ?? '') ?? '?', song: songOf(tournament, id) }))
            .filter((e) => e.song !== '');
          return (
            <li key={m.id}>
              <button
                type="button"
                className="now__row"
                onClick={() => onJump(m.id)}
                aria-label={`Zum Spiel ${m.number}: ${line(m)}`}
              >
                <span className="now__court">Feld {m.court}</span>
                <span className="now__players">{line(m)}</span>
                <span className="now__round">{m.label}</span>
                {songs.length > 0 && (
                  <span className="now__songs">
                    {songs.map((e) => (
                      <span className="now__song" key={e.name}>
                        🎵 {e.name} läuft ein zu: <strong>{e.song}</strong>
                      </span>
                    ))}
                  </span>
                )}
                <span className="now__go" aria-hidden="true">
                  eintragen ▸
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {next.length > 0 && (
        <p className="muted now__next">
          Danach: {next.map(line).join(' · ')}
        </p>
      )}
    </section>
  );
}
