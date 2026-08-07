import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Moves one screen out while the next comes in.
 *
 * Play, Pieces and How to play sit in a row, so switching between them slides
 * sideways in the direction you moved — a screen to the right of the one you
 * are on arrives from the right. Teams is not in that row: it hangs off the
 * strip in the top bar, so it opens out of it instead.
 *
 * Both screens are rendered as one keyed list rather than as two separate
 * slots. Written as separate slots, the screen on its way out lands in a
 * position React has never seen it in, so it is torn down and built again from
 * nothing — every image reloads and every screen refetches, mid-slide. Keyed by
 * screen, the outgoing one keeps the DOM it already had and only its class
 * changes.
 *
 * The switch is worked out while rendering rather than in an effect. Effects
 * run after the browser has painted, so starting from one left a frame where
 * the new screen was already sitting in its final place with no animation on
 * it, and the outgoing screen had to be put back in afterwards — remounting the
 * very thing the keyed list exists to preserve.
 */

/**
 * Comfortably longer than the longest pair in the stylesheet, so a class is
 * never pulled while a screen is still short of home. Opening the teams panel
 * is the long one: the screen underneath waits for the panel to cover it before
 * it fades, so the two run one after the other rather than together.
 */
const DURATION = 560;

type Move = 'forward' | 'back' | 'expand' | 'collapse';

interface Pane {
  view: string;
  order: number;
  expand: boolean;
  node: ReactNode;
}

export function Slider({
  view,
  order,
  expand = false,
  children,
}: {
  /** Identity of the current screen. A change is what triggers a transition. */
  view: string;
  /** Position in the left-to-right row, which gives the slide its direction. */
  order: number;
  /** This screen opens out of the top bar rather than sliding in. */
  expand?: boolean;
  children: ReactNode;
}) {
  const [leaving, setLeaving] = useState<{ pane: Pane; move: Move } | null>(null);
  const showing = useRef<Pane>({ view, order, expand, node: children });

  if (view !== showing.current.view) {
    const previous = showing.current;
    setLeaving({
      pane: previous,
      move: expand
        ? 'expand'
        : previous.expand
          ? 'collapse'
          : order >= previous.order
            ? 'forward'
            : 'back',
    });
  }

  // Kept current, so the screen recorded as leaving is the one that was really
  // on screen rather than whatever was there at the last transition.
  showing.current = { view, order, expand, node: children };

  useEffect(() => {
    if (!leaving) return;
    const done = setTimeout(() => setLeaving(null), DURATION);
    return () => clearTimeout(done);
  }, [leaving]);

  const panes = [
    ...(leaving ? [{ ...leaving.pane, tone: `leaving-${leaving.move}`, gone: true }] : []),
    { view, node: children, tone: leaving ? `entering-${leaving.move}` : '', gone: false },
  ];

  return (
    <div className="slider">
      {panes.map((pane) => (
        <div
          key={pane.view}
          className={`slide ${pane.tone}`.trim()}
          aria-hidden={pane.gone || undefined}
        >
          {pane.node}
        </div>
      ))}
    </div>
  );
}
