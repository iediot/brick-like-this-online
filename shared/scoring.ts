/**
 * Round scoring.
 *
 * Two binary masks of identical dimensions: where the card's silhouette is,
 * and where the player's bricks are. Everything reduces to how much of the
 * silhouette got filled versus how much brick spilled outside it.
 *
 * This is deliberately deterministic. A vision model asked "does this fit?"
 * gives a different answer on a re-run, and in a party game an unrepeatable
 * verdict is an argument waiting to happen.
 */

/** Below this, the build did not meaningfully fill the shape and scores nothing. */
const PASS_THRESHOLD = 0.45;

/** Spilling outside the lines hurts more than leaving gaps — it is more visible. */
const OVERFLOW_WEIGHT = 1.4;

/**
 * Below this share of the frame, nothing meaningfully changed between the two
 * shots — no build, or the camera never saw one. That is not a bad score, it is
 * an absent one, and it is reported as such rather than as zero out of eight.
 */
const EMPTY_THRESHOLD = 0.004;

export interface RoundScore {
  /** Nothing was photographed. No score is meaningful. */
  empty: boolean;
  /** Fraction of the silhouette covered by bricks. */
  coverage: number;
  /** Fraction of the build's mass sitting outside the silhouette. */
  overflow: number;
  /** Combined 0..1 quality. */
  quality: number;
  points: number;
  verdict: string;
  /** Pixel counts, useful when tuning or debugging a bad capture. */
  debug: { silhouettePx: number; buildPx: number; insidePx: number; outsidePx: number };
}

export function scoreMasks(
  silhouette: Uint8Array,
  build: Uint8Array,
  cardPoints: number,
): RoundScore {
  if (silhouette.length !== build.length) {
    throw new Error(
      `mask size mismatch: silhouette ${silhouette.length}, build ${build.length}`,
    );
  }

  let silhouettePx = 0;
  let buildPx = 0;
  let insidePx = 0;

  for (let i = 0; i < silhouette.length; i++) {
    const inShape = silhouette[i] !== 0;
    const hasBrick = build[i] !== 0;
    if (inShape) silhouettePx++;
    if (hasBrick) {
      buildPx++;
      if (inShape) insidePx++;
    }
  }

  const outsidePx = buildPx - insidePx;
  const coverage = silhouettePx > 0 ? insidePx / silhouettePx : 0;
  const overflow = buildPx > 0 ? outsidePx / buildPx : 0;
  const empty = buildPx / silhouette.length < EMPTY_THRESHOLD;

  const quality = empty ? 0 : clamp(coverage - overflow * OVERFLOW_WEIGHT, 0, 1);
  const points = !empty && quality >= PASS_THRESHOLD ? Math.round(cardPoints * quality) : 0;

  return {
    empty,
    coverage,
    overflow,
    quality,
    points,
    verdict: empty ? pick(NOTHING, coverage) : verdictFor(quality, coverage, overflow),
    debug: { silhouettePx, buildPx, insidePx, outsidePx },
  };
}

/*
 * Verdicts.
 *
 * Several per band, so the same phrase does not come back every round, and
 * genuinely unkind at the bottom — a party game that congratulates a pile of
 * bricks for being a pile of bricks is not much of a judge.
 */

const NOTHING = [
  'There is nothing there. Was the camera pointed at the table?',
  'A photo of an empty surface. Bold, but not a model.',
  'Nothing changed between the two shots. Nothing to score.',
  'The camera saw no bricks at all.',
];

const DISASTER = [
  'That is not the shape. That is not any shape.',
  'Nothing about this matches the card. Nothing.',
  'Somewhere in there is a model. Not this one.',
  'Comfortably the wrong answer.',
];

const BAD = [
  'Barely a resemblance. No points.',
  'The right idea, executed by somebody else entirely.',
  'Wrong enough that the card is not going to argue.',
  'A shape was attempted. That is the kindest reading.',
];

const SPILLING = [
  'Bricks everywhere they should not be. No points.',
  'More build outside the outline than inside it.',
  'You have covered the shape and quite a lot of the table.',
];

const CLOSE = [
  'Close. Not close enough.',
  'Almost — and almost scores nothing.',
  'You can see what it was meant to be. So can the card.',
];

const SCRAPED = [
  'Scraped it. The gaps are showing.',
  'It counts. It should not, but it counts.',
  'Rough, holey, and just about the right shape.',
];

const DECENT = [
  'Recognisably right. Gaps, though.',
  'Good enough, if you do not look closely.',
  'Solid work with a few holes in it.',
];

const GOOD = [
  'Clean fit.',
  'That is the shape, and neatly done.',
  'Very little to complain about.',
];

const PERFECT = [
  'Filled it almost completely. Show-off.',
  'Near-perfect. Irritatingly good.',
  'The card has no notes.',
];

/** Deterministic per result, so re-reading a score does not change its verdict. */
function pick(options: string[], seed: number): string {
  const index = Math.floor(Math.abs(seed) * 1000) % options.length;
  return options[index];
}

function verdictFor(quality: number, coverage: number, overflow: number): string {
  if (quality < PASS_THRESHOLD) {
    if (overflow > 0.35) return pick(SPILLING, coverage);
    if (coverage < 0.2) return pick(DISASTER, coverage);
    if (quality > 0.35) return pick(CLOSE, coverage);
    return pick(BAD, coverage);
  }
  if (quality < 0.55) return pick(SCRAPED, coverage);
  if (overflow > 0.2) return pick(SPILLING, coverage);
  if (quality < 0.72) return pick(DECENT, coverage);
  if (coverage > 0.9 && quality > 0.85) return pick(PERFECT, coverage);
  return pick(GOOD, coverage);
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
