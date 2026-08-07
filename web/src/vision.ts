/**
 * Brick detection from a single frame.
 *
 * The camera only opens once, at the end of the round, so there is no empty
 * reference shot to difference against. Instead the surface colour is read off
 * the border of the crop — the build sits in the middle of the card, so the
 * edges are table — and anything far enough from that colour is brick.
 *
 * This needs no model, no training data and no network, and it is exactly
 * repeatable, which matters more than cleverness when the output decides who
 * won. It does assume a reasonably plain surface: a heavily patterned table
 * will read as bricks everywhere.
 *
 * Everything works at a fixed resolution so the silhouette mask and the build
 * mask are directly comparable pixel for pixel.
 */

import { CARD_H, CARD_W } from '@shared/card.ts';

/*
 * Masks are built at the card's own proportions, not a square. The live view
 * is the card with the model knocked out of it, so the frame the player aims
 * through has to be the exact frame that gets measured.
 */
export const WORK_W = CARD_W * 4;
export const WORK_H = CARD_H * 4;
const PIXELS = WORK_W * WORK_H;

/** Per-channel distance from the surface colour above which a pixel is brick. */
const SURFACE_THRESHOLD = 44;

/** How far in from each edge is sampled to work out what the table looks like. */
const BORDER = 0.06;

/**
 * Grab a centre crop of the video at the card's proportions.
 *
 * This mirrors `object-fit: cover` on the video element, so what the mask sees
 * is exactly what the player sees through the card. Cropping rather than
 * squashing also keeps the build's proportions honest — a stretched capture
 * would score a correct build as overflowing.
 */
export function captureCard(video: HTMLVideoElement): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = WORK_W;
  canvas.height = WORK_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const wanted = CARD_W / CARD_H;
  const actual = video.videoWidth / video.videoHeight;
  const cropW = actual > wanted ? video.videoHeight * wanted : video.videoWidth;
  const cropH = actual > wanted ? video.videoHeight : video.videoWidth / wanted;

  ctx.drawImage(
    video,
    (video.videoWidth - cropW) / 2,
    (video.videoHeight - cropH) / 2,
    cropW,
    cropH,
    0,
    0,
    WORK_W,
    WORK_H,
  );

  return ctx.getImageData(0, 0, WORK_W, WORK_H);
}

/**
 * Mark the bricks in a frame.
 *
 * Compares channels independently rather than on brightness: a red brick on a
 * grey table can land at nearly identical luminance while being obviously
 * different in colour. This is the one place colour still earns its keep.
 */
export function brickMask(frame: ImageData): Uint8Array {
  const [br, bg, bb] = surfaceColour(frame);
  const mask = new Uint8Array(PIXELS);
  const d = frame.data;

  for (let i = 0; i < PIXELS; i++) {
    const o = i * 4;
    const dr = Math.abs(d[o] - br);
    const dg = Math.abs(d[o + 1] - bg);
    const db = Math.abs(d[o + 2] - bb);
    mask[i] = Math.max(dr, dg, db) > SURFACE_THRESHOLD ? 1 : 0;
  }

  return denoise(mask);
}

/**
 * The table's colour, as the median of a ring of pixels around the edge of the
 * crop. Median rather than mean so that a brick straying into the border, or a
 * shadow along one side, moves the answer barely at all.
 */
function surfaceColour(frame: ImageData): [number, number, number] {
  const insetX = Math.round(WORK_W * BORDER);
  const insetY = Math.round(WORK_H * BORDER);
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;

  for (let y = 0; y < WORK_H; y++) {
    const edgeRow = y < insetY || y >= WORK_H - insetY;
    for (let x = 0; x < WORK_W; x++) {
      if (!edgeRow && x >= insetX && x < WORK_W - insetX) {
        // Skip straight across the middle rather than testing every pixel.
        x = WORK_W - insetX - 1;
        continue;
      }
      const o = (y * WORK_W + x) * 4;
      hist[0][frame.data[o]]++;
      hist[1][frame.data[o + 1]]++;
      hist[2][frame.data[o + 2]]++;
      n++;
    }
  }

  return hist.map((channel) => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += channel[v];
      if (seen * 2 >= n) return v;
    }
    return 255;
  }) as [number, number, number];
}

/**
 * 3x3 majority filter. Camera sensor noise and shadow shift produce speckle
 * that would otherwise read as bricks scattered outside the silhouette, which
 * is the error that costs the most points.
 */
function denoise(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(PIXELS);

  for (let y = 1; y < WORK_H - 1; y++) {
    for (let x = 1; x < WORK_W - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          n += mask[(y + dy) * WORK_W + (x + dx)];
        }
      }
      out[y * WORK_W + x] = n >= 5 ? 1 : 0;
    }
  }

  return out;
}

/**
 * Render the card's model into a mask comparable with the camera frame.
 *
 * Both are the card's own proportions now, so this is a straight scale with no
 * letterboxing to keep in sync.
 */
export function rasterizeSilhouette(path: string): Uint8Array {
  const canvas = document.createElement('canvas');
  canvas.width = WORK_W;
  canvas.height = WORK_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  ctx.scale(WORK_W / CARD_W, WORK_H / CARD_H);
  ctx.fillStyle = '#fff';
  // even-odd so arch openings punch through, matching how cards render.
  ctx.fill(new Path2D(path), 'evenodd');

  const { data } = ctx.getImageData(0, 0, WORK_W, WORK_H);
  const mask = new Uint8Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) mask[i] = data[i * 4 + 3] > 128 ? 1 : 0;
  return mask;
}

/**
 * Visualise the comparison: green where the build fills the shape, red where
 * it spills outside, faint grey for the parts of the shape left empty.
 */
export function renderOverlay(
  canvas: HTMLCanvasElement,
  silhouette: Uint8Array,
  build: Uint8Array,
): void {
  canvas.width = WORK_W;
  canvas.height = WORK_H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(WORK_W, WORK_H);

  for (let i = 0; i < PIXELS; i++) {
    const o = i * 4;
    const inShape = silhouette[i] === 1;
    const hasBrick = build[i] === 1;

    if (inShape && hasBrick) {
      img.data[o] = 34;
      img.data[o + 1] = 170;
      img.data[o + 2] = 85;
      img.data[o + 3] = 235;
    } else if (hasBrick) {
      img.data[o] = 210;
      img.data[o + 1] = 55;
      img.data[o + 2] = 45;
      img.data[o + 3] = 235;
    } else if (inShape) {
      img.data[o] = 140;
      img.data[o + 1] = 140;
      img.data[o + 2] = 140;
      img.data[o + 3] = 70;
    } else {
      img.data[o + 3] = 0;
    }
  }

  ctx.putImageData(img, 0, 0);
}
