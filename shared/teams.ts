/**
 * Teams.
 *
 * The game is played in pairs: an Instructor who sees the card and talks, and a
 * Builder who handles the bricks and does not. Up to four teams play at once.
 */

export const MIN_TEAMS = 1;
export const MAX_TEAMS = 4;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;

export interface Team {
  id: string;
  name: string;
  /** Exactly two: one instructs, one builds. */
  players: string[];
  /**
   * Rounds this team has finished. Drives the role swap: the players trade
   * places after their own turn, not after everybody's, so a team that has
   * played twice is back where it started.
   */
  roundsPlayed: number;
  score: number;
}

/**
 * Colours matched to the logo, so each team reads as its own at a glance.
 *
 * All four have to hold up on the yellow window as well as on white, which
 * rules out the logo's own yellow — it vanished against the panel behind it.
 * The teal and orange are deepened for the same reason.
 */
export const TEAM_COLOURS = ['#bd3a86', '#127f72', '#23395e', '#d1550c'] as const;

export function colourFor(index: number): string {
  return TEAM_COLOURS[index % TEAM_COLOURS.length];
}

export function emptyTeam(index: number): Team {
  return {
    id: `team-${index + 1}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Team ${index + 1}`,
    players: ['', ''],
    roundsPlayed: 0,
    score: 0,
  };
}

export type Role = 'instructor' | 'builder';

/** Which role a player holds this round. They alternate every round played. */
export function roleOf(team: Team, playerIndex: number): Role {
  const instructing = team.roundsPlayed % 2;
  return playerIndex === instructing ? 'instructor' : 'builder';
}

export const ROLE_LABELS: Record<Role, string> = {
  instructor: 'Observer',
  builder: 'Builder',
};

export const ROLE_ICONS: Record<Role, string> = {
  instructor: '/observer.png',
  builder: '/builder.png',
};

/**
 * A team is usable once it has a name and at least two named players — the two
 * roles are the game, so a team of one has nobody to describe the card to.
 */
export function isReady(team: Team): boolean {
  return team.name.trim().length > 0 && team.players.filter((p) => p.trim()).length >= MIN_PLAYERS;
}

/** Strip blank player slots and trim, ready for storage. */
export function tidy(team: Team): Team {
  return {
    ...team,
    name: team.name.trim(),
    players: team.players.map((p) => p.trim()).filter(Boolean),
  };
}
