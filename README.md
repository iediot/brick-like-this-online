# Brick Like This — online

A digital take on the LEGO party game. Draw a shape card showing a small model,
build it out of your own bricks, photograph it, get scored.

The twist over the physical game: the models are generated from **your**
inventory rather than printed on 92 fixed cards, so every model is assembled
from bricks you actually own.

## The game it's based on

*Brick Like This!* (Dotted Games / LEGO, designed by Luca Bellini) is a
describe-and-build party game. One player — the **Instructor** — takes a shape
card and describes the model out loud; their partner, the **Builder**, builds it
without seeing the card. All teams race simultaneously against a 30-second
timer, over six rounds.

Details that shaped this implementation:

- **The number on a card is both the brick count and the points.** A "7" card
  is a model made of exactly seven bricks, and it scores seven. Models run from
  five to eight bricks — they are small.
- **You pick a pile before seeing the model.** The only information you have is
  the number, so the choice is purely how much you're willing to take on.
- **Cards show the individual brick outlines.** You need to be able to read off
  which bricks go where in order to describe it.
- **The card is 1:1 scale.** Finished models are placed on the card to check
  them.
- Models are **abstract arrangements**, not pictures of ducks or cars. That's
  the point — they're just bricks stuck together.

The box also has 20 Challenge cards (build one-handed, eyes closed) worth 1–3
bonus points to whoever finishes first. Not implemented yet.

## How it works

```
inventory (what's on your table)
        │
        ▼
   card generator ── place N real bricks, each touching the last
        │
        ▼
     round ── model outline overlaid on the live camera
        │
        ▼
    scoring ── frame diff → build mask → coverage vs. overflow
```

### Where the AI is, and where it deliberately isn't

A model runs in exactly one place: **reading your pile**. That job is
irreducibly perception — no algorithm looks at a heap of bricks and knows
what's in it, and the only alternative is typing counts by hand. Everything
else is procedural, on purpose:

**Models are placed, not drawn.** The generator doesn't invent a shape and hope
it's buildable — it takes real bricks from your inventory at their real
footprints and places them one at a time, each touching what's already there.
Buildability is guaranteed by construction, and because the generator knows the
bricks individually it can draw each one's outline on the card.

Candidate placements are weighted by how much edge they share with the existing
model. Without that weighting the placement wanders and produces long snakes —
technically valid, tedious to describe out loud, nothing like the real cards.

**Scoring is deterministic.** A vision model asked "does this fit?" gives a
different answer on a re-run. In a party game an unrepeatable verdict is an
argument waiting to happen, so the fit is measured, not judged.

### The inventory is deliberately coarse

We don't identify LEGO part numbers. That's ~4,000 shapes of fine-grained
classification on an occluded pile, and nothing downstream needs it — the
generator wants footprints and counts.

Colour is absent entirely: cards show shape, so no consumer ever reads it.

The upside is a large error tolerance. If the inventory says 38 bricks and there
are 34, nothing downstream notices. Very little software gets to be this wrong
and still be right, and the whole design leans on it.

### Flat, shot from above

The model lies flat and is photographed top-down. Side-on is truer to the
physical game but much harder to score fairly — perspective, background and
scale all move. Top-down removes all three.

## Running it

```bash
npm install
npm run build          # build the web app
npm start              # server on :8787, serves the built app
```

For development, two processes with hot reload:

```bash
npm run dev:server     # :8787
npm run dev:web        # :5173, proxies /api to the server
```

The camera needs HTTPS or localhost.

## The pile scanner

Photograph your bricks, get the inventory form pre-filled. Runs entirely on
this machine through [Ollama](https://ollama.com) — no network, no account,
nothing to expire.

```bash
brew install ollama
ollama pull qwen2.5vl:7b        # ~6GB
```

The server starts Ollama alongside itself, so the model comes up with the app.
That start is deliberately not awaited: the game is playable without it, so a
slow or failed model start never delays the server.

Two things make a mediocre scanner acceptable:

- **Results land in the editable form**, so a miscount is a two-tap correction
  rather than a bug. That's why the form was built first — the rest of the game
  was never blocked on model quality.
- **The error tolerance is enormous**, as above.

Counting many small objects is a known weak spot for vision models, so the
prompt asks for grouped estimates rather than a tally, and the server clamps the
output — a model claiming 4000 bricks would silently wreck every card it sizes.

Override with `SCAN_MODEL` or `OLLAMA_HOST`.

## Layout

| Path                | What                                                    |
| ------------------- | ------------------------------------------------------- |
| `shared/card.ts`    | Brick placement, outline tracing, card geometry         |
| `shared/scoring.ts` | Mask comparison → points                                |
| `shared/inventory.ts` | Shape classes and the capability summary              |
| `server/`           | HTTP + SQLite + the scanner. Zero npm dependencies.     |
| `web/`              | React app: inventory editor, scanner, camera, scoring   |

The server has no npm dependencies — Node 26 ships SQLite (`node:sqlite`) and
runs TypeScript natively, so `node server/src/index.ts` just works.

## Not built yet

- **Challenge cards** — the 1–3 point modifiers, claimed by whoever finishes
  first.
- **The Instructor/Builder split.** Currently one person sees the card and
  builds it. The real game's whole engine is that the person describing cannot
  see what the person building is doing. Two devices, or one passed around.
- **Rounds and a running score** — the real game is six rounds against a
  30-second timer.
- **A trained detector.** The vision model is the zero-training bootstrap; a
  YOLO fine-tuned on the eight coarse shape classes would be faster, run on
  CPU, and handle a whole pile in one frame.

## Sources

- [How to Play LEGO's Brick Like This! — Asmodee](https://www.asmodee.co.uk/blogs/news/how-to-play-lego-s-brick-like-this-game)
- [Brick Like This! — Dotted Games](https://www.dottedgames.com/bricklikethis/)
- [Brick Like This! rules — Geeky Hobbies](https://www.geekyhobbies.com/lego-brick-like-this-rules/)
# brick-like-this-online
