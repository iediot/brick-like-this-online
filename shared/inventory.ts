/**
 * The piece catalogue.
 *
 * Every entry is a real LEGO element, with its part number in a comment so it
 * can be checked. An earlier version of this file invented sizes that do not
 * exist, which made the piece list untrustworthy.
 *
 * ## Dimensions
 *
 * LEGO's System is built on a small set of exact measurements:
 *
 * | Measurement      | Real size | In stud pitches |
 * |------------------|-----------|-----------------|
 * | Stud pitch       | 8.0 mm    | 1.0             |
 * | Brick height     | 9.6 mm    | 1.2             |
 * | Plate height     | 3.2 mm    | 0.4             |
 * | Stud diameter    | 4.8 mm    | 0.6             |
 * | Stud height      | 1.8 mm    | 0.225           |
 *
 * A brick is exactly three plates tall, which is why heights below are
 * counted in plates. Everything drawn on a card uses these ratios, so a plate
 * looks like a plate and a stud sits at the right size on top of a brick.
 *
 * Depth is deliberately absent, and so are all the 2xN parts. Builds in this
 * game are flat, single-layer and studs-up, so a 2x4 brick presents exactly
 * the same rectangle as a 1x4 — carrying both meant two entries that drew
 * identically and could not be told apart on a board with no names. Only the
 * silhouette matters, so the catalogue only describes silhouettes.
 */

export type PieceFamily = 'brick' | 'plate' | 'tile' | 'slope' | 'inverted' | 'arch';

export interface PieceType {
  id: string;
  label: string;
  family: PieceFamily;
  /** Width in studs. */
  studs: number;
  /**
   * Height in plates. Brick = 3, plate = 1.
   *
   * Fractional values are allowed so a piece can be drawn thinner than the
   * grid it sits on — see the tiles below.
   */
  plates: number;
}

/** Exact LEGO geometry, in stud pitches. Used by every drawing routine. */
export const GEOMETRY = {
  studPitchMm: 8.0,
  brickHeightMm: 9.6,
  plateHeightMm: 3.2,
  /** Plate height as a fraction of stud pitch: 3.2 / 8.0. */
  plateRatio: 0.4,
  /** Stud diameter as a fraction of stud pitch: 4.8 / 8.0. */
  studDiameter: 0.6,
  /**
   * Width the studs are actually drawn at, a shade narrower than life.
   *
   * A real stud is 0.6 of a stud pitch across, but that is a cylinder seen in
   * the round. Drawn flat as a bump on a silhouette it reads heavier than it
   * looks in the hand, so it is pulled in slightly — just enough to keep a
   * visible gap between neighbouring studs without them looking spindly.
   */
  studDrawWidth: 0.55,
  /** Stud height as a fraction of stud pitch: 1.8 / 8.0. */
  studHeight: 0.225,
} as const;

const BRICK = 3;
const PLATE = 1;
/** Just over stud height (0.225 of a stud pitch, or ~0.56 plates). */
const TILE = 0.7;

export const CATALOGUE: PieceType[] = [
  // Bricks — part numbers 3005, 3004, 3622, 3010, 3009, 3008.
  { id: 'brick-1x1', label: '1x1 Brick', family: 'brick', studs: 1, plates: BRICK },
  { id: 'brick-1x2', label: '1x2 Brick', family: 'brick', studs: 2, plates: BRICK },
  { id: 'brick-1x3', label: '1x3 Brick', family: 'brick', studs: 3, plates: BRICK },
  { id: 'brick-1x4', label: '1x4 Brick', family: 'brick', studs: 4, plates: BRICK },
  { id: 'brick-1x6', label: '1x6 Brick', family: 'brick', studs: 6, plates: BRICK },
  { id: 'brick-1x8', label: '1x8 Brick', family: 'brick', studs: 8, plates: BRICK },
  // Plates — 3024, 3023, 3623, 3710, 3666, 3022, 3020.
  { id: 'plate-1x1', label: '1x1 Plate', family: 'plate', studs: 1, plates: PLATE },
  { id: 'plate-1x2', label: '1x2 Plate', family: 'plate', studs: 2, plates: PLATE },
  { id: 'plate-1x3', label: '1x3 Plate', family: 'plate', studs: 3, plates: PLATE },
  { id: 'plate-1x4', label: '1x4 Plate', family: 'plate', studs: 4, plates: PLATE },
  { id: 'plate-1x6', label: '1x6 Plate', family: 'plate', studs: 6, plates: PLATE },

  // Tiles — 3070, 3069, 2431. Smooth top, so nothing stacks and no studs show.
  //
  // Drawn thinner than a plate even though a real tile is exactly plate height
  // (3.2mm). A plate reads as tall as it does partly because of the stud
  // standing on it; strip that away and the same rectangle looks like a chunky
  // slab rather than the flat cap a tile is. TILE keeps it just above stud
  // height, which is how they read in a model.
  { id: 'tile-1x1', label: '1x1 Tile', family: 'tile', studs: 1, plates: TILE },
  { id: 'tile-1x2', label: '1x2 Tile', family: 'tile', studs: 2, plates: TILE },
  { id: 'tile-1x4', label: '1x4 Tile', family: 'tile', studs: 4, plates: TILE },

  // Slopes — 3040 (45deg 1x2) and 4286 (33deg 1x3) are one brick tall.
  //
  // The steep one (60481) is two bricks tall over the same two-stud run, which
  // is why it earns a place: taller over the same length means a far more
  // abrupt ramp, since the flat lip at the low end is a single plate on every
  // slope regardless of height.
  { id: 'slope-1x2', label: '1x2 Slope', family: 'slope', studs: 2, plates: BRICK },
  { id: 'slope-1x3', label: '1x3 Slope', family: 'slope', studs: 3, plates: BRICK },
  { id: 'slope-steep-1x2', label: '1x2 Steep Slope', family: 'slope', studs: 2, plates: BRICK * 2 },

  // Inverted slopes — 3665 (45deg 1x2), 4287 (33deg 1x3).
  //
  // The ramp is cut from the underside: the top is flat and fully studded, and
  // only the tall end reaches the ground. That tall end is the only part that
  // can rest on anything, the same way an arch stands on its legs.
  { id: 'slope-inv-1x2', label: '1x2 Inverted Slope', family: 'inverted', studs: 2, plates: BRICK },
  { id: 'slope-inv-1x3', label: '1x3 Inverted Slope', family: 'inverted', studs: 3, plates: BRICK },

  // Arch — 3659, one brick tall. A leg one stud wide at each end, and at the
  // crown the material thins to a tile's depth.
  { id: 'arch-1x4', label: '1x4 Arch', family: 'arch', studs: 4, plates: BRICK },

];

export const FAMILY_LABELS: Record<PieceFamily, string> = {
  brick: 'Bricks',
  plate: 'Plates',
  tile: 'Tiles',
  slope: 'Slopes',
  inverted: 'Inverted slopes',
  arch: 'Arches',
};

export const PIECE_BY_ID = new Map(CATALOGUE.map((p) => [p.id, p]));

/** How many of each piece the player owns. Only non-zero entries are stored. */
export interface InventoryEntry {
  pieceId: string;
  count: number;
}

export interface CapabilitySummary {
  pieceCount: number;
  /** Widest piece in studs — bounds how far a model can span. */
  maxSpan: number;
  countByFamily: Record<PieceFamily, number>;
  canAngle: boolean;
  canHole: boolean;
}

const emptyByFamily = (): Record<PieceFamily, number> => ({
  brick: 0,
  plate: 0,
  tile: 0,
  slope: 0,
  inverted: 0,
  arch: 0,
});

export function summarize(entries: InventoryEntry[]): CapabilitySummary {
  const countByFamily = emptyByFamily();
  let pieceCount = 0;
  let maxSpan = 0;

  for (const e of entries) {
    const piece = PIECE_BY_ID.get(e.pieceId);
    if (!piece || e.count <= 0) continue;
    countByFamily[piece.family] += e.count;
    pieceCount += e.count;
    maxSpan = Math.max(maxSpan, piece.studs);
  }

  return {
    pieceCount,
    maxSpan,
    countByFamily,
    canAngle: countByFamily.slope > 0 || countByFamily.inverted > 0,
    canHole: countByFamily.arch > 0,
  };
}
