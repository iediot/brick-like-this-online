/**
 * The sand timer.
 *
 * The physical game ships a 30-second glass, and flipping it is the moment the
 * round starts. Turning it over here does the same job: it marks the start
 * rather than just displaying a number.
 *
 * `remaining` runs 1 to 0 and drives the level in each bulb, so the glass
 * empties in step with the count.
 */

/**
 * The glass, as one continuous outline pinched to a neck at the middle.
 *
 * Drawn as a single path so the two bulbs meet in a real waist. Stroking each
 * bulb separately put two outlines through the same point and read as an X
 * across the middle of the glass.
 */
const GLASS =
  'M 14 12 H 42 C 42 22 30 25 30 32 C 30 39 42 42 42 52 H 14 C 14 42 26 39 26 32 C 26 25 14 22 14 12 Z';

/** The same curves again, split, purely to clip each bulb's sand. */
const UPPER = 'M 14 12 H 42 C 42 22 30 25 30 32 H 26 C 26 25 14 22 14 12 Z';
const LOWER = 'M 26 32 C 26 39 14 42 14 52 H 42 C 42 42 30 39 30 32 H 26 Z';

/** The axis the glass is symmetric about, and the waist it drains through. */
const CENTRE = 28;
const NECK = 32;

type Point = readonly [number, number];

/**
 * Sand leaves an hourglass at a constant volume per second — that is the whole
 * point of the instrument — so the surface in the top bulb barely moves while
 * the bulb is wide and then races once it narrows into the neck. Driving the
 * level straight off the clock made it fall at a constant speed, which is the
 * one thing a real timer never does.
 *
 * So each bulb gets a table built by integrating its width down the edge curve,
 * mapping a fraction of the bulb's area to the height that holds it. Both
 * bulbs measure from their wide end, which is where the sand rests: the neck
 * for the top one, the floor for the bottom.
 */
const STEPS = 240;

function levelForArea(p0: Point, p1: Point, p2: Point, p3: Point): (fraction: number) => number {
  const ys = new Float64Array(STEPS + 1);
  const widths = new Float64Array(STEPS + 1);

  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const u = 1 - t;
    const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    const x = b[0] * p0[0] + b[1] * p1[0] + b[2] * p2[0] + b[3] * p3[0];
    ys[i] = b[0] * p0[1] + b[1] * p1[1] + b[2] * p2[1] + b[3] * p3[1];
    widths[i] = 2 * Math.abs(x - CENTRE);
  }

  // Area between each sample and the end of the curve, by trapezoid.
  const area = new Float64Array(STEPS + 1);
  for (let i = STEPS - 1; i >= 0; i--) {
    area[i] = area[i + 1] + ((widths[i] + widths[i + 1]) / 2) * Math.abs(ys[i + 1] - ys[i]);
  }
  const total = area[0];

  return (fraction) => {
    const want = Math.max(0, Math.min(1, fraction)) * total;
    for (let i = STEPS - 1; i >= 0; i--) {
      if (area[i] < want) continue;
      const span = area[i] - area[i + 1];
      return ys[i] + (ys[i + 1] - ys[i]) * (span > 0 ? (area[i] - want) / span : 0);
    }
    return ys[STEPS];
  };
}

/** The right-hand edges of the two bulbs, straight off the GLASS outline. */
const upperLevel = levelForArea([42, 12], [42, 22], [30, 25], [30, NECK]);
const lowerLevel = levelForArea([30, NECK], [30, 39], [42, 42], [42, 52]);

export function Hourglass({ running, remaining }: { running: boolean; remaining: number }) {
  const top = Math.max(0, Math.min(1, remaining));
  const bottom = 1 - top;
  const draining = running && top > 0 && top < 1;

  /* Upper bulb: the surface sinks towards the neck, dipping in the middle as a
     funnel forms over the hole. The dip flattens out as the sand runs low. */
  const level = upperLevel(top);
  const dip = 3.5 * top;

  /* Lower bulb: a cone piling up from the floor. */
  const peak = lowerLevel(bottom);

  return (
    <svg
      viewBox="0 0 56 64"
      className={`hourglass${running ? ' flipped' : ''}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id="hg-upper">
          <path d={UPPER} />
        </clipPath>
        <clipPath id="hg-lower">
          <path d={LOWER} />
        </clipPath>
      </defs>

      {/* Opaque: the sand is amber and the panel behind is yellow, so a
          translucent bulb left the level invisible. */}
      <path className="hg-glass" d={GLASS} />

      {/* Flipping the glass turns the sand with it, which would leave a full
          timer pooled at the bottom. The sand counter-rotates so it always
          falls down the screen, and since the glass is symmetric under a
          half-turn the clips still line up. */}
      <g transform={running ? 'rotate(180 28 32)' : undefined}>
        {top > 0.005 ? (
          <g clipPath="url(#hg-upper)">
            <path
              className="hg-sand"
              d={`M 6 ${level} Q 28 ${level + dip * 2} 48 ${level} L 48 33 L 6 33 Z`}
            />
          </g>
        ) : null}

        {bottom > 0.005 ? (
          <g clipPath="url(#hg-lower)">
            <path
              className="hg-sand"
              d={`M 6 ${peak + 3} Q 28 ${peak - 3} 48 ${peak + 3} L 48 53 L 6 53 Z`}
            />
          </g>
        ) : null}

        {/* The stream, tapering as it falls and stopping at the surface of the
            pile. Clipped to the lower bulb, which begins at the neck: clipped
            to the whole glass instead, it carried on above the waist and showed
            as a stray line across the top bulb once the sand there ran low. */}
        {draining ? (
          <path
            className="hg-sand"
            clipPath="url(#hg-lower)"
            d={`M 27.15 31 H 28.85 L 28.4 ${peak} H 27.6 Z`}
          />
        ) : null}
      </g>

      <path className="hg-edge" d={GLASS} />

      <g className="hg-frame">
        <rect x="4" y="2" width="48" height="10" rx="3" />
        <rect x="4" y="52" width="48" height="10" rx="3" />
        <rect x="6" y="10" width="5" height="44" rx="2.5" />
        <rect x="45" y="10" width="5" height="44" rx="2.5" />
      </g>
    </svg>
  );
}

/** mm:ss is overkill for half a minute; seconds read faster. */
export function formatSeconds(seconds: number): string {
  return `${Math.max(0, Math.ceil(seconds))}`;
}
