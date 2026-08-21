import { useState } from 'react';
import type { Player, Tournament } from '../engine/types';
import { LIMITS, eliminatedIn, stillPlayingIn } from '../engine/tournament';

interface Props {
  tournament: Tournament;
  locked: boolean;
  /** Nur Mitlesen: nichts ist änderbar. */
  readOnly: boolean;
  /** Mehrere Namen in einem Schritt – wichtig fürs Einfügen aus einer Liste. */
  onAddMany: (names: string[], asChampion: boolean) => void;
  onRename: (id: string, name: string) => void;
  onSetSong: (id: string, song: string) => void;
  onToggleChampion: (id: string) => void;
  onRemove: (id: string) => void;
  onRemoveAll: () => void;
}

export function PlayerList({
  tournament,
  locked,
  readOnly,
  onAddMany,
  onRename,
  onSetSong,
  onToggleChampion,
  onRemove,
  onRemoveAll,
}: Props) {
  const players = tournament.players;
  const [name, setName] = useState('');
  const [champion, setChampion] = useState(false);
  const [bulk, setBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const full = players.length >= LIMITS.players;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onAddMany([trimmed], champion);
    setName('');
    setChampion(false);
  };

  const addBulk = (): void => {
    const names = bulk
      .split(/[\n,;]+/)
      .map((n) => n.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    onAddMany(names.slice(0, Math.max(0, LIMITS.players - players.length)), false);
    setBulk('');
    setShowBulk(false);
  };

  return (
    <section className="card">
      <h2>Wer spielt mit?</h2>
      <p className="muted">
        Namen eintragen, Einlaufmusik dazu und die Vorjahresgewinner ankreuzen. Die werden bei
        der Auslosung so gesetzt, dass sie erst möglichst spät aufeinandertreffen. Die Musik
        erscheint unter „Jetzt dran“, sobald das Spiel dran ist.
      </p>

      {locked && !readOnly && (
        <div className="note note--info">
          Der Spielplan steht. Namen und Einlaufmusik lassen sich weiter korrigieren – kommt
          jemand dazu oder fällt weg, braucht es eine neue Auslosung.
        </div>
      )}

      {!locked && !readOnly && (
        <>
          <form className="add-form" onSubmit={submit}>
            <div className="add-form__name">
              <label htmlFor="new-player">Name</label>
              <input
                id="new-player"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. Anna"
                autoComplete="off"
                maxLength={LIMITS.nameLength}
                disabled={full}
              />
            </div>
            <label className="checkbox add-form__champ">
              <input type="checkbox" checked={champion} onChange={(e) => setChampion(e.target.checked)} />
              <span>🏆 Vorjahresgewinner</span>
            </label>
            <button className="btn btn--primary" type="submit" disabled={!name.trim() || full}>
              Hinzufügen
            </button>
          </form>

          <div className="btn-row" style={{ marginTop: 10 }}>
            <button className="btn btn--small" type="button" onClick={() => setShowBulk((v) => !v)} disabled={full}>
              {showBulk ? 'Eingabe schließen' : 'Mehrere Namen einfügen'}
            </button>
            {players.length > 0 && (
              <button
                className="btn btn--small"
                type="button"
                onClick={() => {
                  if (confirm('Wirklich alle Namen entfernen?')) onRemoveAll();
                }}
              >
                Alle entfernen
              </button>
            )}
          </div>

          {showBulk && (
            <div style={{ marginTop: 10 }}>
              <label htmlFor="bulk">Ein Name pro Zeile (Komma geht auch)</label>
              <textarea
                id="bulk"
                rows={5}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={'Anna\nBen\nCarla'}
              />
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn btn--primary btn--small" type="button" onClick={addBulk} disabled={!bulk.trim()}>
                  Alle übernehmen
                </button>
              </div>
            </div>
          )}
          {full && <p className="muted">Mehr als {LIMITS.players} Personen sind nicht vorgesehen.</p>}
        </>
      )}

      <div style={{ marginTop: 14 }}>
        {players.length === 0 ? (
          <p className="muted">Noch niemand eingetragen.</p>
        ) : (
          <>
            <p className="muted">
              {players.length} {players.length === 1 ? 'Person' : 'Personen'} ·{' '}
              {players.filter((p) => p.isChampion).length} als Vorjahresgewinner markiert
            </p>
            <ul className="player-list">
              {players.map((player, index) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  index={index}
                  locked={locked}
                  readOnly={readOnly}
                  out={outLabel(tournament, player.id, locked)}
                  still={stillLabel(tournament, player.id, locked)}
                  onRename={onRename}
                  onSetSong={onSetSong}
                  onToggleChampion={onToggleChampion}
                  onRemove={onRemove}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/** „raus"-Hinweis nur, wenn wirklich kein offenes Spiel mehr wartet. */
function outLabel(t: Tournament, id: string, locked: boolean): string | null {
  if (!locked) return null;
  const lost = eliminatedIn(t, id);
  if (!lost || stillPlayingIn(t, id)) return null;
  return lost;
}

/** Wer verloren hat, aber noch spielt, bekommt den Hinweis, wo. */
function stillLabel(t: Tournament, id: string, locked: boolean): string | null {
  if (!locked) return null;
  if (!eliminatedIn(t, id)) return null;
  return stillPlayingIn(t, id);
}

function PlayerRow({
  player,
  index,
  locked,
  readOnly,
  out,
  still,
  onRename,
  onSetSong,
  onToggleChampion,
  onRemove,
}: {
  player: Player;
  index: number;
  locked: boolean;
  readOnly: boolean;
  out: string | null;
  still: string | null;
  onRename: (id: string, name: string) => void;
  onSetSong: (id: string, song: string) => void;
  onToggleChampion: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  // Das Musikfeld nur zeigen, wenn es gebraucht wird – sonst wird die Liste
  // mit 18 Personen doppelt so hoch wie nötig.
  const [songOpen, setSongOpen] = useState(false);
  const showSong = songOpen || player.song !== '';

  return (
    <li className="player-row">
      <span className="player-row__index">{index + 1}.</span>
      <span className="player-row__name">
        <label className="visually-hidden" htmlFor={`name-${player.id}`}>
          Name von Person {index + 1}
        </label>
        <input
          id={`name-${player.id}`}
          type="text"
          value={player.name}
          maxLength={LIMITS.nameLength}
          disabled={readOnly}
          onChange={(e) => onRename(player.id, e.target.value)}
        />
        {showSong && (
          <>
            <label className="visually-hidden" htmlFor={`song-${player.id}`}>
              Einlaufmusik von {player.name || `Person ${index + 1}`}
            </label>
            <input
              id={`song-${player.id}`}
              className="player-row__song"
              type="text"
              value={player.song}
              maxLength={LIMITS.songLength}
              disabled={readOnly}
              placeholder="🎵 Einlaufmusik"
              autoFocus={songOpen && player.song === ''}
              onChange={(e) => onSetSong(player.id, e.target.value)}
            />
          </>
        )}
      </span>
      {!readOnly && !showSong && (
        <button
          className="btn btn--small btn--icon"
          type="button"
          title="Einlaufmusik eintragen"
          aria-label={`Einlaufmusik von ${player.name || `Person ${index + 1}`} eintragen`}
          onClick={() => setSongOpen(true)}
        >
          🎵
        </button>
      )}
      {out && <span className="chip">raus: {out}</span>}
      {still && <span className="chip chip--live">jetzt: {still}</span>}
      <label className="checkbox player-row__champ" title="Vorjahresgewinner">
        <input
          type="checkbox"
          checked={player.isChampion}
          disabled={locked || readOnly}
          onChange={() => onToggleChampion(player.id)}
        />
        <span aria-hidden="true">🏆</span>
        <span className="visually-hidden">
          {player.name || `Person ${index + 1}`} ist Vorjahresgewinner
        </span>
      </label>
      {!locked && !readOnly && (
        <button
          className="btn btn--danger btn--icon"
          type="button"
          onClick={() => {
            if (confirm(`${player.name || 'Diese Person'} wirklich entfernen?`)) onRemove(player.id);
          }}
          aria-label={`${player.name || `Person ${index + 1}`} entfernen`}
        >
          ✕
        </button>
      )}
    </li>
  );
}
