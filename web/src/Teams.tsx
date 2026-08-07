import { useState } from 'react';
import {
  MAX_PLAYERS,
  MAX_TEAMS,
  colourFor,
  emptyTeam,
  isReady,
  tidy,
  type Team,
} from '@shared/teams.ts';
import { api } from './api.ts';

/**
 * Team setup.
 *
 * Shown as a gate on a first visit, and reachable afterwards to edit. Teams are
 * pairs by design — one player describes the card, the other builds it — so a
 * team is only usable once it has two named people.
 */
export function Teams({
  teams,
  onSave,
  firstRun,
}: {
  teams: Team[];
  onSave: (teams: Team[]) => void;
  firstRun?: boolean;
}) {
  const [draft, setDraft] = useState<Team[]>(() =>
    teams.length > 0 ? teams : [emptyTeam(0), emptyTeam(1)],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);

  /**
   * Teams are fixed once a game is under way. Scores and roles are tied to who
   * is on which team, so editing the roster mid-game would leave points
   * attached to people who are no longer playing. Restarting is the way out.
   */
  const locked = !firstRun;

  const restart = async () => {
    if (!confirmRestart) {
      setConfirmRestart(true);
      return;
    }
    setSaving(true);
    try {
      await api.restartGame();
      onSave([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const update = (id: string, patch: Partial<Team>) =>
    setDraft((all) => all.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const setPlayer = (id: string, index: number, value: string) =>
    setDraft((all) =>
      all.map((t) => {
        if (t.id !== id) return t;
        const players = [...t.players];
        players[index] = value;
        return { ...t, players };
      }),
    );

  const usable = draft.filter(isReady);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { teams: saved } = await api.saveTeams(usable.map(tidy));
      onSave(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel teams">
      <div className="teams-head">
        <h2>{firstRun ? 'Who is playing?' : 'Teams'}</h2>
        <p className="muted">
          Two players a side: one describes the card, the other builds it. Swap after each round.
        </p>
      </div>

      <div className="team-grid">
        {draft.map((team, i) => (
          <section key={team.id} className="team-card" style={{ '--team': colourFor(i) } as never}>
            <header className="team-head">
              <input
                className="team-name"
                value={team.name}
                maxLength={40}
                disabled={locked}
                aria-label={`Team ${i + 1} name`}
                onChange={(e) => update(team.id, { name: e.target.value })}
              />
              {draft.length > 1 && !locked ? (
                <button
                  className="ghost"
                  aria-label={`Remove ${team.name}`}
                  onClick={() => setDraft((all) => all.filter((t) => t.id !== team.id))}
                >
                  ×
                </button>
              ) : null}
            </header>

            {Array.from({ length: MAX_PLAYERS }, (_, slot) => (
              <input
                key={slot}
                className="player-name"
                value={team.players[slot] ?? ''}
                maxLength={24}
                disabled={locked}
                placeholder={slot === 0 ? 'Player 1' : 'Player 2'}
                aria-label={`${team.name} player ${slot + 1}`}
                onChange={(e) => setPlayer(team.id, slot, e.target.value)}
              />
            ))}
          </section>
        ))}

        {draft.length < MAX_TEAMS && !locked ? (
          <button
            className="add-team"
            onClick={() => setDraft((all) => [...all, emptyTeam(all.length)])}
          >
            + Add a team
          </button>
        ) : null}
      </div>

      <div className="save-bar">
        <span className="muted">
          {confirmRestart
            ? 'This clears the teams and the scores.'
            : locked
            ? 'Locked for this game'
            : usable.length === 0
              ? 'Each team needs a name and two players'
              : `${usable.length} team${usable.length === 1 ? '' : 's'} ready`}
        </span>
        <div className="save-actions">
          {locked ? (
            <button
              className={confirmRestart ? 'danger' : ''}
              onClick={() => void restart()}
              disabled={saving}
            >
              {confirmRestart ? 'Yes, delete them' : 'Restart game'}
            </button>
          ) : null}

          {/* While a restart is pending, the other button is the way out of it
              rather than a save that cannot happen anyway. */}
          {confirmRestart ? (
            <button className="primary" onClick={() => setConfirmRestart(false)}>
              Cancel
            </button>
          ) : (
            <button
              className="primary"
              onClick={() => void save()}
              disabled={locked || usable.length === 0 || saving}
            >
              {saving ? 'Saving…' : firstRun ? 'Start playing' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
