import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '@shared/card.ts';
import { ModelFigure, StudPips } from './CardFace.tsx';

/**
 * Taking a card off a pile, and putting it back.
 *
 * The card turns over where it ends up rather than where it started: the stage
 * is already laid out underneath by the time this runs, so the destination is
 * measured from the real slot the card will occupy and the card travels to it
 * as it turns. Turning it in the middle of the row and then swapping the piles
 * for the stage made the card jump at the moment of the swap, because the two
 * places are not the same place.
 *
 * Everything here is fixed-position in a portal on the body, so it floats over
 * whatever is underneath without disturbing a single box of it — and it cannot
 * be knocked off by an ancestor's transform.
 */

/** Kept in step with the transition in the stylesheet. */
export const DEAL_MS = 620;

export interface DealOrigin {
  /** Where the chosen card sat on its pile. */
  from: DOMRect;
  /** The piles left behind, and the edge each is nearer to. */
  others: { count: number; rect: DOMRect; exit: 'left' | 'right' }[];
}

export function DealTransition({
  card,
  origin,
  slot,
  deckSlot,
  carry = false,
  reverse = false,
  onDone,
}: {
  card: Card;
  origin: DealOrigin;
  /** The card's resting place on the stage, measured once it is laid out. */
  slot: RefObject<HTMLElement | null>;
  /** Where the pile it came off ends up, beside the card. */
  deckSlot?: RefObject<HTMLElement | null>;
  /** Whether the pile travels too. It does not on a redraw: it is already there. */
  carry?: boolean;
  /** Putting it back rather than taking it. */
  reverse?: boolean;
  onDone: () => void;
}) {
  const [to, setTo] = useState<DOMRect | null>(null);
  const [toDeck, setToDeck] = useState<DOMRect | null>(null);
  const [moved, setMoved] = useState(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  // Before paint, so the card is never seen in the wrong place.
  useLayoutEffect(() => {
    if (slot.current) setTo(slot.current.getBoundingClientRect());
    if (deckSlot?.current) setToDeck(deckSlot.current.getBoundingClientRect());
  }, [slot, deckSlot]);

  useEffect(() => {
    if (!to) return;
    // One painted frame at the starting transform, or there is nothing for the
    // transition to move away from.
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => setMoved(true)));
    // A fallback only. The transition itself is what normally ends this — a
    // timer set to the same length is racing it, and loses often enough that
    // the card gets pulled mid-turn.
    const done = setTimeout(() => finish.current(), DEAL_MS + 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(done);
    };
  }, [to]);

  if (!to) return null;

  /* The card is positioned on its destination and inverted back to the pile,
     so it finishes on an untransformed box of exactly the right size. */
  const atPile = `translate(${origin.from.left - to.left}px, ${
    origin.from.top - to.top
  }px) scale(${to.width ? origin.from.width / to.width : 1}) rotateY(0deg)`;
  const atStage = 'translate(0px, 0px) scale(1) rotateY(180deg)';
  const start = reverse ? atStage : atPile;
  const end = reverse ? atPile : atStage;

  /* The pile the card came off does not leave the table — it moves across to
     sit beside the card, which is where it is for the rest of the round. */
  const deckAtPile = toDeck
    ? `translate(${origin.from.left - toDeck.left}px, ${
        origin.from.top - toDeck.top
      }px) scale(${toDeck.width ? origin.from.width / toDeck.width : 1})`
    : '';
  const deckAtStage = 'translate(0px, 0px) scale(1)';
  const deckStart = reverse ? deckAtStage : deckAtPile;
  const deckEnd = reverse ? deckAtPile : deckAtStage;

  return createPortal(
    <div className="deal-layer" aria-hidden="true">
      {origin.others.map((other) => (
        <div
          key={other.count}
          className={`pile-ghost tier-${other.count} ${reverse ? 'coming' : 'going'} exit-${
            other.exit
          }`}
          style={box(other.rect)}
        >
          <span className="face front">
            <span className="numeral">{other.count}</span>
            <StudPips count={other.count} />
          </span>
        </div>
      ))}

      {carry && toDeck ? (
        <div className="pile-carry" style={box(toDeck)}>
          <div
            className={`carry-card tier-${card.count}`}
            style={{ transform: moved ? deckEnd : deckStart }}
          >
            <span className="face front">
              <span className="numeral">{card.count}</span>
              <StudPips count={card.count} />
            </span>
          </div>
        </div>
      ) : null}

      <div className={`flight tier-${card.count}`} style={box(to)}>
        <div
          className="flight-card"
          style={{ transform: moved ? end : start }}
          onTransitionEnd={(e) => {
            if (e.propertyName === 'transform') finish.current();
          }}
        >
          <span className="face front">
            <span className="numeral">{card.count}</span>
            <StudPips count={card.count} />
          </span>
          <span className="face back">
            <span className="corner">{card.count}</span>
            <ModelFigure card={card} />
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const box = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
