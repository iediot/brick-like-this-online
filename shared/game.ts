/**
 * Game state.
 *
 * The physical game has every team building at once against one sand timer.
 * Here they take turns instead: one team plays a round, gets scored, and the
 * turn passes. That suits a single screen and a single camera, and it means a
 * team's two players can trade roles right after their own turn rather than
 * waiting for everybody else.
 */

import type { Team } from './teams.ts';

export const TOTAL_ROUNDS = 6;

export interface GameState {
  /** 1-based, up to TOTAL_ROUNDS. */
  round: number;
  /** Index into teams. */
  activeTeam: number;
  teams: Team[];
  finished: boolean;
}

export function activeTeamOf(game: GameState): Team | null {
  return game.teams[game.activeTeam] ?? null;
}

/**
 * Hand the turn on.
 *
 * The active team's own round counter goes up, which swaps its two players'
 * roles. When the turn wraps back to the first team the round number advances,
 * and after the last round the game is over.
 */
export function advance(game: GameState): GameState {
  const teams = game.teams.map((team, i) =>
    i === game.activeTeam ? { ...team, roundsPlayed: team.roundsPlayed + 1 } : team,
  );

  const nextTeam = (game.activeTeam + 1) % Math.max(1, teams.length);
  const wrapped = nextTeam === 0;
  const round = wrapped ? game.round + 1 : game.round;

  return {
    round: Math.min(round, TOTAL_ROUNDS),
    activeTeam: nextTeam,
    teams,
    finished: round > TOTAL_ROUNDS,
  };
}

/** Highest score wins; ties share it, as the rulebook says. */
export function winners(game: GameState): Team[] {
  const best = Math.max(0, ...game.teams.map((t) => t.score));
  return game.teams.filter((t) => t.score === best && best > 0);
}
