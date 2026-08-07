/**
 * Card generation.
 *
 * A card shows a small model — 5 to 8 pieces, the number being both the piece
 * count and the points, as in the physical game. Models are abstract
 * arrangements; the interest comes from the piece count, not from looking like
 * anything.
 *
 * The view is an elevation: pieces seen from the front, resting on the ground
 * or on each other. That is what gives the cards their wall-and-battlement
 * look, with studs bumping along every exposed top edge and holes where an
 * arch spans a gap.
 *
 * Pieces are taken from the player's actual inventory and dropped under
 * gravity, so a model can always be built and always stands up.
 */

import {
  GEOMETRY,
  PIECE_BY_ID,
  type InventoryEntry,
  type PieceFamily,
  type PieceType,
} from './inventory.ts';

export type PieceCount = 5 | 6 | 7 | 8;
export const PIECE_COUNTS: PieceCount[] = [5, 6, 7, 8];

export interface PlacedPiece {
  pieceId: string;
  family: PieceFamily;
  /** Left edge in studs. */
  x: number;
  /** Bottom edge in plates, measured up from the ground. */
  y: number;
  studs: number;
  plates: number;
  /** Slopes and arches are drawn mirrored half the time, for variety. */
  flipped: boolean;
}

export interface Card {
  id: string;
  pieces: PlacedPiece[];
  count: PieceCount;
  points: number;
  grid: { studs: number; plates: number };
  /** Filled outline of the whole model, for camera scoring. */
  path: string;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface GenerateOptions {
  count?: PieceCount;
  seed?: string;
}

interface Stock {
  piece: PieceType;
  left: number;
}

/** Placement consumes stock, so each attempt needs its own copy. */
function freshStock(entries: InventoryEntry[]): Stock[] {
  return entries
    .map((e) => ({ piece: PIECE_BY_ID.get(e.pieceId)!, left: e.count }))
    .filter((s) => s.piece && s.left > 0);
}

export function generateCard(entries: InventoryEntry[], opts: GenerateOptions = {}): Card {
  const seedStr = opts.seed ?? Math.random().toString(36).slice(2, 10);
  const rand = mulberry32(hashString(seedStr));

  const total = freshStock(entries).reduce((n, s) => n + s.left, 0);
  if (total === 0) throw new Error('No pieces to build with.');

  const requested = opts.count ?? PIECE_COUNTS[Math.floor(rand() * PIECE_COUNTS.length)];
  const count = Math.max(1, Math.min(requested, total));

  // Placement can dead-end: a model may grow into a shape where nothing left
  // in the pile can legally attach. Rather than hand back a 7 card carrying
  // six pieces, build it again from a fresh arrangement.
  let pieces = build(freshStock(entries), count, rand);
  for (let attempt = 0; attempt < 12 && pieces.length < count; attempt++) {
    pieces = build(freshStock(entries), count, rand);
  }

  const grid = gridOf(pieces);

  return {
    id: seedStr,
    pieces,
    count: pieces.length as PieceCount,
    points: pieces.length,
    grid,
    path: pieces.map((p) => piecePath(p, pieces, layout(grid))).join(' '),
  };
}

/**
 * Drop pieces one at a time, each clutching onto a stud below it.
 *
 * Two pieces are joined only when one sits on a stud of the other. Sitting
 * beside something is not a join, and neither is sitting on a tile — a tile has
 * a smooth top and nothing grips it. Enforcing that during placement is what
 * makes every generated model liftable as one object.
 *
 * A piece may overhang the thing it rests on, which is how models get wider
 * without needing separate stacks: LEGO holds perfectly well by one stud.
 */
function build(stock: Stock[], count: number, rand: () => number): PlacedPiece[] {
  const placed: PlacedPiece[] = [];
  /** Top surface height per stud column, in plates. */
  const heights = new Map<number, number>();
  /** Whether that top surface actually offers a stud to clutch. */
  const studded = new Map<number, boolean>();

  for (let i = 0; i < count; i++) {
    const remaining = count - i;
    const attempt = placeOne(stock, placed, heights, studded, rand, remaining);
    if (!attempt) break;
  }

  return normalize(placed);
}

/**
 * Place one piece, trying alternatives when the first choice will not attach.
 *
 * Giving up on the first failure left a quarter of models short of their piece
 * count — a "7" card delivering five pieces — because tiles cap the columns
 * they sit on and eventually block everything. Trying the rest of the stock
 * fixes that without loosening the connection rule.
 */
function placeOne(
  stock: Stock[],
  placed: PlacedPiece[],
  heights: Map<number, number>,
  studded: Map<number, boolean>,
  rand: () => number,
  remaining: number,
): boolean {
  for (const index of stockOrder(stock, rand, remaining)) {
    const piece = stock[index].piece;
    // Settled first: for an inverted slope the flip decides which end can
    // carry the piece, so the spot search needs to know it.
    const flipped = rand() < 0.5;
    const spot = chooseSpot(piece, flipped, placed, heights, studded, rand);
    if (!spot) continue;

    placed.push({
      pieceId: piece.id,
      family: piece.family,
      x: spot.x,
      y: spot.y,
      studs: piece.studs,
      plates: piece.plates,
      flipped,
    });

    // A slope only offers the single stud on its high shelf; a tile offers
    // none at all. Everything else is studded across its full width.
    const shelfColumn = flipped ? spot.x + piece.studs - 1 : spot.x;
    for (let c = spot.x; c < spot.x + piece.studs; c++) {
      heights.set(c, spot.y + piece.plates);
      studded.set(
        c,
        piece.family === 'tile' ? false : piece.family === 'slope' ? c === shelfColumn : true,
      );
      void shelfColumn;
    }

    stock[index].left--;
    return true;
  }

  return false;
}

/**
 * Stock indices in weighted-random order, most likely first.
 *
 * Weighted by how many you own, so a pile of 1x2s shows up more often than the
 * single arch. Tiles are held back until near the end of the model: they cap
 * whatever they sit on, so an early tile closes off building room.
 */
function stockOrder(stock: Stock[], rand: () => number, remaining: number): number[] {
  const pool = stock
    .map((s, i) => ({
      i,
      weight: s.left * (s.piece.family === 'tile' && remaining > 2 ? 0.15 : 1),
    }))
    .filter((entry) => stock[entry.i].left > 0);

  const order: number[] = [];
  while (pool.length > 0) {
    const pick = weightedPick(
      pool.map((entry) => entry.weight),
      rand,
    );
    order.push(pool[pick].i);
    pool.splice(pick, 1);
  }
  return order;
}


interface Spot {
  x: number;
  y: number;
}

/**
 * The columns of a piece that have material along its bottom edge.
 *
 * Everything is solid underneath except an arch, which is open between its two
 * legs — the middle of a 1x4 arch is empty space, so it can neither rest on a
 * stud there nor be blocked by one. Only the end columns can carry it.
 */
function footingColumns(piece: {
  family: PieceFamily;
  studs: number;
  flipped: boolean;
}): number[] {
  // An arch stands on a leg at each end; the span between them is open.
  if (piece.family === 'arch') return [0, piece.studs - 1];
  // An inverted slope has its ramp cut from underneath, so only the tall end
  // reaches down far enough to sit on anything.
  if (piece.family === 'inverted') return [piece.flipped ? piece.studs - 1 : 0];
  return Array.from({ length: piece.studs }, (_, i) => i);
}

/**
 * Find somewhere the piece can actually attach.
 *
 * A candidate rests at the highest surface it spans. It only counts as
 * connected if at least one of the columns it lands on is both at that exact
 * height and offers a stud — resting across a gap or against a smooth top is
 * not a connection.
 */
function chooseSpot(
  piece: PieceType,
  flipped: boolean,
  placed: PlacedPiece[],
  heights: Map<number, number>,
  studded: Map<number, boolean>,
  rand: () => number,
): Spot | null {
  if (placed.length === 0) return { x: 0, y: 0 };

  const columns = [...heights.keys()];
  const minX = Math.min(...columns);
  const maxX = Math.max(...columns);

  const candidates: Array<Spot & { weight: number }> = [];

  const footings = footingColumns({ ...piece, flipped });
  const spans = Array.from({ length: piece.studs }, (_, i) => i);
  const hollow = spans.filter((i) => !footings.includes(i));

  for (let x = minX - piece.studs + 1; x <= maxX + 1; x++) {
    // The piece settles on its legs, not on whatever happens to be under its
    // open middle.
    let y = 0;
    for (const i of footings) y = Math.max(y, heights.get(x + i) ?? 0);

    let grip = 0;
    for (const i of footings) {
      if ((heights.get(x + i) ?? 0) === y && studded.get(x + i)) grip++;
    }
    if (grip === 0) continue;

    // Nothing may poke up into the opening the piece is spanning.
    if (hollow.some((i) => (heights.get(x + i) ?? 0) > y)) continue;

    // Favour more grip, so models hang together rather than dangling off a
    // single stud every time — but leave room for the occasional overhang.
    candidates.push({ x, y, weight: grip * grip });
  }

  if (candidates.length === 0) return null;
  const chosen = candidates[weightedPick(candidates.map((c) => c.weight), rand)];
  return { x: chosen.x, y: chosen.y };
}

/**
 * Check every piece is held by a stud of the piece below it.
 *
 * Placement guarantees this by construction; this exists so the guarantee is
 * testable rather than assumed.
 */
export function isSingleObject(pieces: PlacedPiece[]): boolean {
  if (pieces.length <= 1) return true;

  return pieces.every((piece, index) => {
    if (index === 0) return true;

    // Only the columns where this piece has material underneath can be held.
    const feet = footingColumns(piece).map((i) => piece.x + i);

    return pieces.some((below) => {
      if (below === piece) return false;
      if (below.y + below.plates !== piece.y) return false;
      if (below.family === 'tile') return false;

      const overlap = feet.filter((c) => c >= below.x && c < below.x + below.studs);
      if (overlap.length === 0) return false;

      if (below.family !== 'slope') return true;
      // Only the shelf end of a slope has a stud to offer.
      const shelf = below.flipped ? below.x + below.studs - 1 : below.x;
      return overlap.includes(shelf);
    });
  });
}

function weightedPick(weights: number[], rand: () => number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return Math.floor(rand() * weights.length);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

/** Shift the model so it starts at column 0. */
function normalize(placed: PlacedPiece[]): PlacedPiece[] {
  if (placed.length === 0) return placed;
  const minX = Math.min(...placed.map((p) => p.x));
  return placed.map((p) => ({ ...p, x: p.x - minX }));
}

function gridOf(placed: PlacedPiece[]): { studs: number; plates: number } {
  if (placed.length === 0) return { studs: 1, plates: 1 };
  return {
    studs: Math.max(...placed.map((p) => p.x + p.studs)),
    // Leave a plate of headroom so studs on the top row are not clipped.
    plates: Math.max(...placed.map((p) => p.y + p.plates)) + 1,
  };
}

// ---- Geometry ----------------------------------------------------------

/**
 * The card is drawn into a viewBox shaped like a real playing card (63x88mm),
 * not a square, so the artwork sits on the card the way the printed ones do.
 */
export const CARD_W = 63;
export const CARD_H = 88;

/** The card face. Anything else drawing pieces passes its own box. */
const CARD_BOX = { w: CARD_W, h: CARD_H };

export interface Layout {
  scale: number;
  offsetX: number;
  offsetY: number;
  studW: number;
  plateH: number;
  grid: { studs: number; plates: number };
}

/**
 * Fit the model inside a box, preserving true LEGO proportions.
 *
 * The box defaults to the card face. The piece list passes a wide, short box
 * instead: a row of pieces up to eight studs long would otherwise sit as a thin
 * band stranded in the middle of a tall portrait frame.
 */
export function layout(
  grid: { studs: number; plates: number },
  box: { w: number; h: number } = CARD_BOX,
): Layout {
  const margin = Math.min(box.w, box.h) * 0.11;
  const boxW = box.w - margin * 2;
  const boxH = box.h - margin * 2;
  const widthUnits = grid.studs;
  const heightUnits = grid.plates * GEOMETRY.plateRatio;
  const scale = Math.min(boxW / widthUnits, boxH / heightUnits);

  return {
    scale,
    offsetX: margin + (boxW - widthUnits * scale) / 2,
    offsetY: margin + (boxH - heightUnits * scale) / 2,
    studW: scale,
    plateH: scale * GEOMETRY.plateRatio,
    grid,
  };
}

/** Convert a piece's grid position to its bounding box on the card. */
export function pieceBox(
  p: PlacedPiece,
  l: Layout,
): { x: number; y: number; w: number; h: number } {
  return {
    x: r(l.offsetX + p.x * l.studW),
    // y counts upward from the ground; SVG counts downward from the top.
    y: r(l.offsetY + (l.grid.plates - p.y - p.plates) * l.plateH),
    w: r(p.studs * l.studW),
    h: r(p.plates * l.plateH),
  };
}

/**
 * The complete outline of one piece, studs included.
 *
 * The studs are part of the same path as the body, not separate shapes sitting
 * on top of it — a stud is a bump in the brick's top edge, and drawing it as a
 * detached rectangle makes it read as a separate object balanced on the brick.
 *
 * Studs only appear where nothing rests on the piece, and never on tiles,
 * which are smooth.
 */
export function piecePath(p: PlacedPiece, all: PlacedPiece[], l: Layout): string {
  const b = pieceBox(p, l);

  switch (p.family) {
    case 'slope':
      return slopePath(p, all, l, b);
    case 'inverted':
      return invertedSlopePath(p, all, l, b);
    case 'arch':
      return archPath(p, all, l, b);
    case 'tile':
      return `M ${b.x} ${b.y} H ${b.x + b.w} V ${b.y + b.h} H ${b.x} Z`;
    default:
      return `M ${b.x} ${b.y + b.h} V ${b.y} ${toppedEdge(p, all, l, b.x, b.y, p.studs)} V ${b.y + b.h} Z`;
  }
}

/**
 * Walk left to right across a top edge, stepping up and over each exposed stud.
 *
 * Returns the path commands only, so callers can splice this into whatever
 * outline they are building.
 */
function toppedEdge(
  p: PlacedPiece,
  all: PlacedPiece[],
  l: Layout,
  startX: number,
  top: number,
  columns: number,
  fromColumn = 0,
): string {
  const studW = l.studW * GEOMETRY.studDrawWidth;
  const studH = l.studW * GEOMETRY.studHeight;
  const inset = (l.studW - studW) / 2;
  const parts: string[] = [];

  for (let i = 0; i < columns; i++) {
    const column = p.x + fromColumn + i;
    const left = startX + i * l.studW;

    if (isCovered(p, all, column)) {
      parts.push(`H ${r(left + l.studW)}`);
      continue;
    }

    // Just break the two upper corners — a moulded stud is not a sharp-edged
    // box. The sides stay dead straight all the way down, so the junction with
    // the brick is a clean right angle.
    const x1 = left + inset;
    const x2 = x1 + studW;
    const crown = top - studH;
    // Barely there — enough to take the print off a hard corner, no more.
    const round = Math.min(studW * 0.05, studH * 0.14);

    parts.push(
      `H ${r(x1)}`,
      `V ${r(crown + round)}`,
      `Q ${r(x1)} ${r(crown)} ${r(x1 + round)} ${r(crown)}`,
      `H ${r(x2 - round)}`,
      `Q ${r(x2)} ${r(crown)} ${r(x2)} ${r(crown + round)}`,
      `V ${r(top)}`,
      `H ${r(left + l.studW)}`,
    );
  }

  return parts.join(' ');
}

function isCovered(p: PlacedPiece, all: PlacedPiece[], column: number): boolean {
  return all.some(
    (o) => o !== p && o.y === p.y + p.plates && column >= o.x && column < o.x + o.studs,
  );
}

/**
 * A slope.
 *
 * Real slopes are one stud longer than their ramp: a flat, full-height shelf
 * at the tall end carries a single stud, and the diagonal runs from the end of
 * that shelf down towards the base.
 *
 * The low end stops short of the floor and drops vertically over the last
 * plate, rather than tapering to a point. Every LEGO slope has that little
 * vertical face — a knife edge would be unmouldable, and it is the detail that
 * stops the shape reading as a plain triangle.
 */
function slopePath(
  p: PlacedPiece,
  all: PlacedPiece[],
  l: Layout,
  b: { x: number; y: number; w: number; h: number },
): string {
  const shelf = l.studW; // the flat stud at the tall end
  const lip = l.plateH; // vertical face at the low end
  const bottom = b.y + b.h;

  if (p.flipped) {
    // Shelf on the right, ramp rising to it from the left.
    const shelfLeft = b.x + b.w - shelf;
    return (
      `M ${b.x} ${r(bottom - lip)} ` +
      `L ${r(shelfLeft)} ${b.y} ` +
      `${toppedEdge(p, all, l, shelfLeft, b.y, 1, p.studs - 1)} ` +
      `V ${r(bottom)} ` +
      `H ${b.x} Z`
    );
  }

  // Shelf on the left, ramp falling away to the right.
  return (
    `M ${b.x} ${r(bottom)} V ${b.y} ` +
    `${toppedEdge(p, all, l, b.x, b.y, 1)} ` +
    `L ${r(b.x + b.w)} ${r(bottom - lip)} ` +
    `V ${r(bottom)} Z`
  );
}

/**
 * An inverted slope (parts 3665 and 4287).
 *
 * The ramp is cut out of the underside rather than the top: the top stays flat
 * and fully studded across, one end runs the full height to the ground, and
 * the underside climbs away from it, leaving the far end as just a thin lip of
 * material.
 */
function invertedSlopePath(
  p: PlacedPiece,
  all: PlacedPiece[],
  l: Layout,
  b: { x: number; y: number; w: number; h: number },
): string {
  const foot = l.studW; // the full-height end that reaches the ground
  const lip = l.plateH; // thickness left at the raised end
  const bottom = b.y + b.h;

  if (p.flipped) {
    // Full-height end on the right.
    return (
      `M ${r(b.x)} ${r(b.y + lip)} ` +
      `V ${b.y} ` +
      `${toppedEdge(p, all, l, b.x, b.y, p.studs)} ` +
      `V ${r(bottom)} ` +
      `H ${r(b.x + b.w - foot)} Z`
    );
  }

  // Full-height end on the left.
  return (
    `M ${b.x} ${r(bottom)} V ${b.y} ` +
    `${toppedEdge(p, all, l, b.x, b.y, p.studs)} ` +
    `V ${r(b.y + lip)} ` +
    `L ${r(b.x + foot)} ${r(bottom)} Z`
  );
}

/**
 * An arch (part 3659 and friends).
 *
 * A full brick with a curved opening cut up into its underside. The curve
 * springs straight off the bottom edge — there are no vertical legs below it,
 * the "legs" are simply the material left standing either side.
 *
 * The opening is a segmental arch, not a semicircle: a 1x4 arch has a clear
 * span of about three studs but is only 1.2 studs tall, so a true half-circle
 * would need a radius taller than the brick itself.
 *
 * It is traced as one continuous outline rather than as a separate hole. A
 * hole subpath has to close along the bottom, laying an edge exactly on top of
 * the brick's own bottom edge, and two coincident edges leave an anti-aliased
 * hairline of background showing through.
 */
function archPath(
  p: PlacedPiece,
  all: PlacedPiece[],
  l: Layout,
  b: { x: number; y: number; w: number; h: number },
): string {
  // One full stud each side: the legs have to cover a whole stud, since those
  // are the only columns that can sit on anything.
  const leg = l.studW;
  const bottom = b.y + b.h;
  const rx = (b.w - leg * 2) / 2;
  // At the crown the brick thins to a tile's depth — that thin band is all
  // that remains above the opening at its highest point.
  const ry = b.h - l.plateH * 0.7;

  return (
    `M ${b.x} ${r(bottom)} V ${b.y} ` +
    `${toppedEdge(p, all, l, b.x, b.y, p.studs)} ` +
    `V ${r(bottom)} ` +
    // Back along the bottom, up and over the opening, then on to the corner.
    `H ${r(b.x + b.w - leg)} ` +
    `A ${r(rx)} ${r(ry)} 0 0 0 ${r(b.x + leg)} ${r(bottom)} ` +
    `Z`
  );
}

const r = (n: number): number => Math.round(n * 100) / 100;
