/**
 * The official rulebook as images, plus what this version does differently.
 *
 * The PDF is a fold-out: each of its two pages is a wide spread carrying
 * several rulebook pages at once. Page 2 holds the rules proper (pages 2-5)
 * and page 1 holds the challenge cards and cover (6-8), so they are shown in
 * that order rather than in file order.
 *
 * Each spread renders whole at full width — never cropped or letterboxed into
 * a fixed box, since anything cut off is a rule somebody cannot read.
 */
const SPREADS = [
  { src: '/rules-page-2.jpg', label: 'Set up, teams, playing a round, and scoring' },
  { src: '/rules-page-1.jpg', label: 'Challenge cards' },
];

export function HowToPlay() {
  return (
    <div className="panel rules">
      <div className="rules-head">
        <h3>Official rules</h3>
        <a className="pdf-link" href="/rules.pdf" target="_blank" rel="noreferrer">
          Open the PDF
        </a>
      </div>

      <div className="rulebook">
        {SPREADS.map((spread) => (
          // Opens full size, because the spreads are wide and the print is small.
          <a key={spread.src} href={spread.src} target="_blank" rel="noreferrer">
            <img className="rules-page" src={spread.src} alt={spread.label} />
          </a>
        ))}
      </div>

      <section>
        <h3>What is different here</h3>
        <ul className="rules-list">
          <li>
            Models are generated from <b>your</b> pieces rather than printed on 92 fixed cards, so
            every one is buildable from what is actually on your table. Pick a pile by how many
            pieces you want to take on — 5 to 8 — and that is also what it is worth.
          </li>
          <li>
            Every model lies flat: one layer, studs up, photographed from above. The card is the
            shape to fill, not a thing to recognise.
          </li>
          <li>
            The sand runs for 30 seconds with the camera off. When it empties the camera opens
            itself and you have 10 seconds to line up the shot — that clock starts when the camera
            is actually showing a picture, not when it was asked for.
          </li>
          <li>
            Scoring is measured, not judged. The table&apos;s colour is read from the edges of the
            photo and anything far enough from it counts as brick, which is then compared against
            the outline. Spilling outside costs more than leaving gaps, and under 45% of the shape
            filled scores nothing. It needs a reasonably plain surface — a busy tablecloth reads as
            bricks everywhere.
          </li>
          <li>
            Six rounds, up to four teams of two, taking turns rather than all building at once.
            The Observer and the Builder swap after <b>their own</b> round, not after everybody
            has played.
          </li>
          <li>
            The 5 card shows the seams between pieces, as the real ones do. From 6 upward you get
            the outline only.
          </li>
          <li>
            Not built yet: challenge cards, and the split that keeps the Builder from seeing the
            card — for now one screen shows everything, so look away.
          </li>
        </ul>
      </section>

      <p className="sources">
        Rulebook © The LEGO Group. Brick Like This! was designed by Luca Bellini for{' '}
        <a href="https://www.dottedgames.com/bricklikethis/">Dotted Games</a>.
      </p>
    </div>
  );
}
