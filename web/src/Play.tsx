import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { CapabilitySummary } from '@shared/inventory.ts';
import { PIECE_COUNTS, type PieceCount, type Card } from '@shared/card.ts';
import { scoreMasks, type RoundScore } from '@shared/scoring.ts';
import { ROLE_ICONS, ROLE_LABELS, colourFor, roleOf } from '@shared/teams.ts';
import { winners, type GameState } from '@shared/game.ts';
import { api } from './api.ts';
import { CountCard, DeckStack, ModelFigure } from './CardFace.tsx';
import { useCamera } from './useCamera.ts';
import { Hourglass, formatSeconds } from './Hourglass.tsx';
import { DealTransition, type DealOrigin } from './DealTransition.tsx';
import { brickMask, captureCard, rasterizeSilhouette, renderOverlay } from './vision.ts';

type Phase = 'idle' | 'card' | 'timing' | 'live' | 'scored';

/** The physical game's sand timer runs 30 seconds. */
const BUILD_SECONDS = 30;
/** Then the camera opens itself and there is a moment to line the shot up. */
const PHOTO_SECONDS = 10;


export function Play({
  summary,
  game,
  onGame,
}: {
  summary: CapabilitySummary;
  game: GameState;
  onGame: (game: GameState) => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [card, setCard] = useState<Card | null>(null);
  const [score, setScore] = useState<RoundScore | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * One model drawn per pile before anything is clicked, so the card has a back
   * to turn over the instant you choose it.
   */
  const [dealt, setDealt] = useState<Partial<Record<PieceCount, Card>>>({});
  /** The card in flight between a pile and the stage, in either direction. */
  const [deal, setDeal] = useState<{
    card: Card;
    origin: DealOrigin;
    reverse: boolean;
    /** Off a pile on the choosing screen, or off the deck beside the stage. */
    source: 'pile' | 'deck';
    /** The real card has taken over; the flying one is on its way out. */
    landed?: boolean;
  } | null>(null);
  /** Where the piles were when this card was taken, so it can be put back. */
  const origin = useRef<DealOrigin | null>(null);
  /** The card's resting place on the stage, which is where it turns over. */
  const slot = useRef<HTMLDivElement>(null);
  /** The pile beside the stage, which a redraw comes off. */
  const deckRef = useRef<HTMLDivElement>(null);
  /** The piles coming back onto the table at the end of a round. */
  const [arriving, setArriving] = useState(false);
  /** The model being covered, kept until the new one has settled on top of it. */
  const [under, setUnder] = useState<Card | null>(null);

  const [secondsLeft, setSecondsLeft] = useState(BUILD_SECONDS);
  const camera = useCamera();
  const overlayRef = useRef<HTMLCanvasElement>(null);

  /**
   * One countdown drives both phases: 30 seconds to build with the camera off,
   * then it opens itself and there are 10 seconds to take the shot.
   *
   * The photo clock does not start until the camera is actually delivering
   * frames. Waking it takes a moment on some machines, and that moment should
   * not come out of the player's ten seconds.
   */
  useEffect(() => {
    if (phase !== 'timing' && phase !== 'live') return;
    if (phase === 'live' && !camera.ready) return;

    const total = phase === 'timing' ? BUILD_SECONDS : PHOTO_SECONDS;
    const started = Date.now();
    setSecondsLeft(total);

    const tick = setInterval(() => {
      const left = Math.max(0, total - (Date.now() - started) / 1000);
      setSecondsLeft(left);
      if (left > 0) return;

      clearInterval(tick);
      if (phase === 'timing') void openCamera();
      else void scoreBuild();
    }, 100);

    return () => clearInterval(tick);
    // scoreBuild closes over the card, which is fixed for this round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, camera.ready]);

  /* Deal a fresh set of backs whenever the piles come back into view. */
  useEffect(() => {
    // Not while a card is on its way off the pile or back onto it: replacing
    // the models mid-turn would change the face that is being turned.
    if (phase !== 'idle' || game.finished || deal) return;
    let cancelled = false;
    void Promise.all(
      PIECE_COUNTS.filter((n) => n <= maxAvailable).map(
        async (n) => [n, await api.drawCard(n)] as const,
      ),
    )
      .then((entries) => {
        if (!cancelled) setDealt(Object.fromEntries(entries));
      })
      .catch((e: Error) => setFailure(e.message));
    return () => {
      cancelled = true;
    };
    // maxAvailable is derived from the summary, which is stable for a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, game.finished, deal]);

  /**
   * Take a card off a pile: it turns over where it lies while the others clear
   * out sideways, and the stage takes over once they are gone.
   */
  const take = (count: PieceCount, event: MouseEvent<HTMLButtonElement>) => {
    const ready = dealt[count];
    if (!ready) {
      // The deal has not landed yet. Fall back to fetching one on the spot.
      void draw(count);
      return;
    }

    /* Measure every pile before the row goes: the chosen card flies from its
       own square, and each of the others leaves by the edge it is nearer to. */
    const deck = event.currentTarget.closest('.deck') as HTMLElement | null;
    const row = deck?.parentElement;
    if (!deck || !row) return;
    const bounds = row.getBoundingClientRect();
    const middle = bounds.left + bounds.width / 2;

    origin.current = {
      from: deck.getBoundingClientRect(),
      /* The pile that was chosen is not in here: it does not clear off to a
         side, it moves across to sit beside the card. */
      others: [...row.querySelectorAll<HTMLElement>('.deck')]
        .filter((el) => Number(el.dataset.count) !== count)
        .map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            count: Number(el.dataset.count),
            rect,
            exit: (rect.left + rect.width / 2 < middle ? 'left' : 'right') as 'left' | 'right',
          };
        }),
    };

    setFailure(null);
    setScore(null);
    setCard(ready);
    setSecondsLeft(BUILD_SECONDS);
    setUnder(null);
    setDeal({ card: ready, origin: origin.current, reverse: false, source: 'pile' });
    setPhase('card');
  };

  /**
   * Put the card back: it turns face down again on its way to the pile it came
   * from, and the rest of the row comes back in from the edges it left by.
   */
  const putBack = () => {
    if (!origin.current || !card) {
      setPhase('idle');
      return;
    }
    setDeal({ card, origin: origin.current, reverse: true, source: 'pile' });
  };

  /**
   * On to the next round. The card is spent, so there is nothing to put back —
   * the piles simply come back in from the edges they left by, which is the
   * deal run backwards.
   */
  const toIdle = () => {
    setDeal(null);
    origin.current = null;
    setUnder(null);
    setArriving(true);
    setPhase('idle');
    setTimeout(() => setArriving(false), 900);
  };

  const draw = async (count?: PieceCount) => {
    setBusy(true);
    setFailure(null);
    try {
      const next = await api.drawCard(count);
      const pile = deckRef.current?.getBoundingClientRect();
      // The one being replaced stays put underneath until the new card has
      // landed on it, so a redraw is a card dealt onto a card rather than one
      // model blinking into another.
      setUnder(card);
      setCard(next);
      setScore(null);
      setSecondsLeft(BUILD_SECONDS);
      setPhase('card');
      // Off the pile beside the stage and face down, turning over on the way —
      // the same journey a card makes when it is first chosen.
      if (pile) {
        setDeal({
          card: next,
          origin: { from: pile, others: [] },
          reverse: false,
          source: 'deck',
        });
      }
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Only ever called when the build time is up. */
  const openCamera = async () => {
    setSecondsLeft(PHOTO_SECONDS);
    setPhase('live');
    if (!(await camera.start(true))) setPhase('card');
  };

  const startBuilding = () => {
    setFailure(null);
    // No camera yet: it stays off for the whole build and opens itself when
    // the sand runs out.
    setPhase('timing');
  };

  const scoreBuild = async () => {
    const video = camera.videoRef.current;
    if (!video || video.videoWidth === 0 || !card) return;

    const build = brickMask(captureCard(video));
    const silhouette = rasterizeSilhouette(card.path);
    const result = scoreMasks(silhouette, build, card.points);

    setScore(result);
    setPhase('scored');
    camera.stop();

    queueMicrotask(() => {
      if (overlayRef.current) renderOverlay(overlayRef.current, silhouette, build);
    });

    try {
      await api.saveRound({
        cardId: card.id,
        brickCount: card.count,
        coverage: result.coverage,
        overflow: result.overflow,
        points: result.points,
      });
    } catch {
      // A failed round log should not eat the player's result.
    }

    try {
      // Awards the points and passes the turn, which also swaps this team's
      // two roles ready for their next go.
      onGame(await api.finishTurn(result.points));
    } catch (e) {
      setFailure((e as Error).message);
    }
  };

  const live = phase === 'live';
  const maxAvailable = Math.min(8, summary.pieceCount);
  const message = failure ?? camera.error;
  const active = game.teams[game.activeTeam];

  return (
    <div className="panel">
      {phase === 'idle' && game.finished ? (
        <div className="center">
          <h2>Game over</h2>
          <ol className="final-scores">
            {[...game.teams]
              .map((team, i) => ({ team, colour: colourFor(i) }))
              .sort((a, b) => b.team.score - a.team.score)
              .map(({ team, colour }) => (
                <li key={team.id} style={{ '--team': colour } as never}>
                  <b>{team.name}</b>
                  <span>{team.score}</span>
                </li>
              ))}
          </ol>
          <p className="verdict">
            {winners(game).map((t) => t.name).join(' and ') || 'Nobody'} wins.
          </p>
          <button className="primary" onClick={() => void api.resetGame().then(onGame)}>
            Play again
          </button>
        </div>
      ) : null}

      {phase === 'idle' && !game.finished ? (
        <div className="center piles">
          <div className="count-row">
            {PIECE_COUNTS.map((n, i) => (
              <CountCard
                key={n}
                count={n}
                disabled={busy || n > maxAvailable || deal !== null}
                arrive={
                  arriving ? (i < PIECE_COUNTS.length / 2 ? 'left' : 'right') : undefined
                }
                delay={
                  arriving
                    ? (i < PIECE_COUNTS.length / 2 ? PIECE_COUNTS.length / 2 - 1 - i : i) * 70
                    : 0
                }
                onPick={(e) => take(n, e)}
              />
            ))}
          </div>
          {maxAvailable < 8 ? (
            <p className="muted small">
              Only {summary.pieceCount} pieces saved, so larger models are unavailable.
            </p>
          ) : null}
        </div>
      ) : null}

      {card && (phase !== 'idle' && (phase !== 'scored' || score)) ? (
        <div
          className={`stage${
            deal && !deal.landed
              ? deal.reverse
                ? ' undealing'
                : deal.source === 'deck'
                  ? ' redealing'
                  : ' dealing'
              : ''
          }`}
        >
          {/* Only before the timer starts: backing out mid-build would throw
              the round away. */}
          {phase === 'card' ? (
            <button className="back-arrow" onClick={putBack} aria-label="Back">
              ←
            </button>
          ) : null}

          {/*
            One stage for the whole round — card, camera, and result. They are
            the same three boxes in the same three places, so scoring changes
            what is in the middle rather than replacing the screen. Built as two
            screens, everything shifted at the moment the photo was taken.
          */}
          <div className="stage-main">
            <DeckStack count={card.count} ref={deckRef} />
            <div className="card-stack">
              {phase === 'scored' ? (
                <canvas ref={overlayRef} className="result-canvas" />
              ) : (
                <>
                  {/* Whatever a redraw is covering, on the table until it is. */}
                  {under ? (
                    <div key={under.id} className={`shape-card beneath tier-${under.count}`}>
                      <span className="corner">{under.count}</span>
                      <ModelFigure card={under} />
                    </div>
                  ) : null}
                  {/* Turning the camera on puts the video behind the card and
                      opens the model as a window, rather than replacing the
                      card and shifting everything around it. */}
                  <div
                    key={card.id}
                    ref={slot}
                    className={`shape-card tier-${card.count}${live ? ' live' : ''}`}
                  >
                    <span className="corner">{card.count}</span>
                    {live ? (
                      <video
                        ref={camera.videoRef}
                        playsInline
                        muted
                        autoPlay
                        className="card-video"
                      />
                    ) : null}
                    <ModelFigure card={card} cutout={live} />
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="stage-side">
            {/* Whose round it is and what to do about it, with the sand beside
                it rather than in among it. */}
            <div className="side-info">
              {phase === 'scored' && score ? (
              <>
                {/* No photo means no measurement, so showing "0 / 7" would be a
                    verdict on a build nobody saw. */}
                {score.empty ? (
                  <div className="result-empty">—</div>
                ) : (
                  <div className="result-points">
                    {score.points}
                    <span> / {card.points}</span>
                  </div>
                )}
                <p className="verdict">{score.verdict}</p>
                {score.empty ? null : (
                  <dl className="metrics">
                    <div>
                      <dt>Filled</dt>
                      <dd>{Math.round(score.coverage * 100)}%</dd>
                    </div>
                    <div>
                      <dt>Spilled over</dt>
                      <dd>{Math.round(score.overflow * 100)}%</dd>
                    </div>
                  </dl>
                )}
                <div className="actions">
                  <button className="primary" onClick={toIdle}>
                    Next round
                  </button>
                </div>
              </>
            ) : (
              <>
                {/* Whose round it is, and which way round they are playing it. */}
                {active ? (
                  <div className="roles" style={{ '--team': colourFor(game.activeTeam) } as never}>
                    <b className="roles-team">{active.name}</b>
                    {active.players.map((player, seat) => {
                      const role = roleOf(active, seat);
                      return (
                        <div key={player} className="role">
                          <img src={ROLE_ICONS[role]} alt="" />
                          <span>
                            <b>{player}</b>
                            <em>{ROLE_LABELS[role]}</em>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Two slots, always both here. Dropping to a single button
                    once building starts changed how the row wrapped, and the
                    column shortened and pulled everything above it up. */}
                <div className="actions">
                  <button
                    className={phase === 'card' ? '' : 'spare'}
                    onClick={() => void draw(card.count)}
                    disabled={phase !== 'card' || busy}
                    tabIndex={phase === 'card' ? undefined : -1}
                    aria-hidden={phase === 'card' ? undefined : true}
                  >
                    Another model
                  </button>
                  {phase === 'timing' ? (
                    <button className="primary" onClick={() => void openCamera()}>
                      Done — check it
                    </button>
                  ) : live ? (
                    <button
                      className="primary"
                      onClick={() => void scoreBuild()}
                      disabled={!camera.ready}
                    >
                      {camera.ready ? 'Score it now' : 'Waking…'}
                    </button>
                  ) : (
                    <button className="primary" onClick={startBuilding}>
                      Start building
                    </button>
                  )}
                </div>
              </>
              )}
            </div>

            {/* Stays through the result, drained, until the piles come back —
                the round is not over until you move on from it. */}
            <div className="timer side-timer">
              <Hourglass
                turned={phase === 'timing' || live || phase === 'scored'}
                remaining={
                  /* Spent once the photo is taken, however it was taken — the
                     sand does not go back up because you scored early. */
                  phase === 'scored' ? 0 : secondsLeft / (live ? PHOTO_SECONDS : BUILD_SECONDS)
                }
              />
              <b
                className={`${secondsLeft <= 3 ? 'out' : ''}${
                  phase === 'timing' || live ? '' : ' waiting'
                }`.trim()}
              >
                {formatSeconds(phase === 'timing' || live ? secondsLeft : BUILD_SECONDS)}
              </b>
            </div>
          </div>
        </div>
      ) : null}

      {deal ? (
        <DealTransition
          card={deal.card}
          origin={deal.origin}
          slot={slot}
          deckSlot={deckRef}
          carry={deal.source === 'pile'}
          reverse={deal.reverse}
          onDone={() => {
            if (deal.reverse) {
              setDeal(null);
              setPhase('idle');
              return;
            }
            /* Uncover the real card first and drop the flying one a frame
               later. Swapping them in one go leaves a seam where neither is
               painted, which shows as a blink of the card's other side. */
            setDeal((d) => (d ? { ...d, landed: true } : null));
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                setDeal(null);
                setUnder(null);
              }),
            );
          }}
        />
      ) : null}

      {message ? <p className="error">{message}</p> : null}
    </div>
  );
}
