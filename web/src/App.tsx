import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { asset } from './asset.ts';
import { api, type InventoryState } from './api.ts';
import { Inventory } from './Inventory.tsx';
import { Play } from './Play.tsx';
import { HowToPlay } from './HowToPlay.tsx';
import { Teams } from './Teams.tsx';
import { Slider } from './Slider.tsx';
import { ROLE_ICONS, ROLE_LABELS, colourFor, roleOf } from '@shared/teams.ts';
import { TOTAL_ROUNDS, type GameState } from '@shared/game.ts';
import './styles.css';

type Tab = 'play' | 'inventory' | 'teams' | 'rules';

const TABS = [
  { id: 'play', label: 'Play' },
  { id: 'inventory', label: 'Pieces' },
  { id: 'rules', label: 'How to play' },
] as const;

/** Left to right across the top bar, which is the direction a switch travels. */
const TAB_ORDER: Record<string, number> = { play: 0, empty: 0, inventory: 1, rules: 2 };

export default function App() {
  const [tab, setTab] = useState<Tab>('play');
  const [inventory, setInventory] = useState<InventoryState | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* The dark pill behind the active tab is one element that moves, rather than
     a background that blinks from one button to another. */
  const navRef = useRef<HTMLElement>(null);
  const [marker, setMarker] = useState<{ left: number; width: number } | null>(null);

  useEffect(() => {
    api
      .getInventory()
      .then(setInventory)
      .catch((e: Error) => setError(e.message));
    api
      .getGame()
      .then(setGame)
      .catch((e: Error) => setError(e.message));
  }, []);

  const empty = !inventory || inventory.summary.pieceCount === 0;
  const loading = !inventory || !game;
  const teams = game?.teams ?? [];
  // A first visit asks who is playing before anything else. The game is built
  // around two people with different jobs, so there is nothing meaningful to
  // show until it knows there are two of you.
  /*
   * No teams yet. It stands in front of Play, because a round needs two people
   * with different jobs and there is nothing to show without them — but not in
   * front of the rest of the app: the pieces are worth filling in first, and
   * the rules are worth reading before you commit to anyone.
   */
  const needsTeams = !loading && teams.length === 0;

  /* Which screen is showing, and where it sits in the row along the top. The
     slider needs both: the name to notice a change, the position to know which
     way to move. Teams is off the row — it opens out of the strip instead. */
  const view = loading
    ? 'loading'
    : tab === 'teams'
      ? 'teams'
      : tab === 'rules'
        ? 'rules'
        : tab === 'inventory'
          ? 'inventory'
          : needsTeams
            ? 'setup'
            : empty
              ? 'empty'
              : 'play';

  const screen = loading ? (
    <p className="muted">Loading…</p>
  ) : tab === 'teams' || (needsTeams && tab === 'play') ? (
    <Teams
      key={teams.map((t) => t.id).join('|') || 'setup'}
      teams={teams}
      firstRun={needsTeams}
      onSave={(saved) => {
        void api.getGame().then(setGame);
        if (saved.length > 0) setTab('play');
      }}
    />
  ) : tab === 'rules' ? (
    <HowToPlay />
  ) : tab === 'inventory' ? (
    <Inventory
      state={inventory}
      onChange={setInventory}
      locked={teams.length > 0}
      onRestart={async () => {
        await api.restartGame();
        setGame(await api.getGame());
      }}
    />
  ) : empty ? (
    <div className="panel center">
      <h2>No pieces yet</h2>
      <p className="muted">
        Cards are sized and shaped around what you actually own, so the game needs to know what is
        on your table before it can deal you anything.
      </p>
      <button className="primary" onClick={() => setTab('inventory')}>
        Add your pieces
      </button>
    </div>
  ) : (
    <Play summary={inventory.summary} game={game} onGame={setGame} />
  );

  /*
   * Measured after every render, because the active tab's width moves with its
   * badge. It has to compare before it stores: handing back a fresh object each
   * time is a state change every render, and a layout effect that changes state
   * every render never stops.
   */
  const measureTab = () => {
    const active = navRef.current?.querySelector<HTMLElement>('.nav-row:not(.nav-lit) button.on');
    if (!active) return;
    const left = active.offsetLeft;
    const width = active.offsetWidth;
    setMarker((at) => (at && at.left === left && at.width === width ? at : { left, width }));
  };

  // Before paint, so the pill is never seen at the wrong tab.
  useLayoutEffect(measureTab);

  useEffect(() => {
    window.addEventListener('resize', measureTab);
    return () => window.removeEventListener('resize', measureTab);
  });

  const tabRow = (lit: boolean) => {
    const row = TABS.map((t) => (
      <button
        key={t.id}
        className={tab === t.id ? 'on' : ''}
        onClick={lit ? undefined : () => setTab(t.id)}
        tabIndex={lit ? -1 : undefined}
      >
        {t.label}
        {t.id === 'inventory' && inventory ? (
          <span className="badge">{inventory.summary.pieceCount}</span>
        ) : null}
      </button>
    ));
    return lit ? row : <div className="nav-row">{row}</div>;
  };

  return (
    <>
      {/* A real element rather than a pseudo-element behind a negative
          z-index: body's own background was painting over that and hiding
          the pattern entirely. */}
      <div className="backdrop" aria-hidden="true" />
      {/* Full-bleed, so the logo reaches the corner instead of stopping at the
          centred content column. */}
      <header className="topbar">
        <h1 className="brand">
          <img src={asset('/logo.png')} alt="Brick Like This! Online" />
        </h1>
        {/* Teams live in the bar rather than on a screen of their own: they
            are standing context for every round, not somewhere you go. */}
        {teams.length > 0 ? (
          <button
            className="team-strip"
            onClick={() => setTab('teams')}
            title="Edit teams"
            aria-label="Edit teams"
          >
            {/* The round lives with the teams rather than on the play screen:
                it is standing context, the same as the scores beside it. */}
            <span className="round-badge">
              <em>Round</em>
              <b>
                {Math.min(game?.round ?? 1, TOTAL_ROUNDS)}
                <i>/{TOTAL_ROUNDS}</i>
              </b>
            </span>
            {/* Their own box, so the round beside them is one thing next to
                another rather than one more item in the same flow. */}
            <span className="team-list">
              {teams.map((team, i) => (
                <span
                  key={team.id}
                  className={`team-chip${game && i === game.activeTeam ? ' active' : ''}`}
                  style={{ '--team': colourFor(i) } as never}
                >
                  <b className="team-title">
                    <span>{team.name}</span>
                    <span className="team-score" title={`${team.score} points`}>
                      {team.score}
                      <span className="pip" />
                    </span>
                  </b>
                  {team.players.map((player, slot) => {
                    const role = roleOf(team, slot);
                    return (
                      <em key={player} className="player">
                        <img src={asset(ROLE_ICONS[role])} alt={ROLE_LABELS[role]} title={ROLE_LABELS[role]} />
                        <span>{player}</span>
                      </em>
                    );
                  })}
                </span>
              ))}
            </span>
          </button>
        ) : null}

        <nav ref={navRef}>
          {tabRow(false)}
          {/* The same labels again in white, behind a window cut to the shape of
              the pill. The pill and the light text are one layer, so a word the
              pill is halfway across is half white and half ink — the change
              happens where the edge is, not all at once across the word. */}
          {marker ? (
            <div
              className="nav-lit nav-row"
              aria-hidden="true"
              data-away={tab === 'teams' ? '' : undefined}
              style={{
                clipPath: `inset(5px calc(100% - ${marker.left + marker.width}px) 5px ${
                  marker.left
                }px round 13px)`,
              }}
            >
              {tabRow(true)}
            </div>
          ) : null}
        </nav>
      </header>

      <div className="app">
      {error ? <p className="error">{error}</p> : null}

      <Slider view={view} order={TAB_ORDER[view] ?? 0} expand={view === 'teams'}>
        {screen}
      </Slider>
      </div>
    </>
  );
}
