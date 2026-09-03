// The headline, hung from the liquid.
//
// The hero is one ink and two things made of it: the reservoir, and the words
// under it. This module is the join. Every letter is warped by what the surface
// is doing across THAT letter's own width — so a peak forming over the "n"
// pulls the "n", spreads its neighbours away from it, and leaves the far end of
// the line where it was.
//
// "Warped", not "stretched". The type used to take one number off the surface,
// the depth directly overhead, and answer it on one axis: fall, and get taller.
// A letter that only ever scales in y is a letter being scaled, whatever is
// driving the number. What it hangs from does not behave that way — a lobe
// pushes the surface OUT, and the surface either side of it goes along. So the
// letters read a displacement field instead: see `SPREAD`, which is where the
// sideways half of it comes from and why `scaleX` is not a separate effect but
// that same field's own derivative.
//
// Two decisions worth stating, because both were the other way first.
//
// The type stays in the DOM. Drawing it on the canvas would have made the
// coupling easier — one surface, one coordinate space — and would have cost the
// real font: canvas has no reliable way to ask for Archivo at wdth 125, so the
// headline would have been set in a narrower instance than the rest of the page
// and the hero would have been the one place the type was wrong. Transforms on
// spans keep the real face, real kerning, and real selectable text.
//
// The reference the hang is measured FROM is the resting outline, computed once
// per layout, not the current frame's own minimum. Self-normalising against the
// frame looked right until the bass heaved the whole surface down at once:
// every column moved together, the minimum moved with them, and the type sat
// perfectly still through the one moment it should have moved most.

/**
 * How much of the liquid's travel the type takes.
 *
 * Greater than 1 on purpose. Most of the time the lower edge sits within a
 * point or two of rest, which at the hero's scale is a handful of pixels —
 * real, and invisible under a headline whose caps are sixty. Taking the
 * surface's travel one-for-one produced an effect you had to be told was there.
 * The letters exaggerate what the liquid does, the way a needle exaggerates a
 * current.
 *
 * The extremes are a different matter, and this constant shipped believing they
 * were not. The comment here used to say the edge descends "about four panel
 * points even on a hard transient". Run against the whole capture it reaches
 * 28.0, and 30.1 with the pointer in the band — seven times the number this
 * gain was chosen against. At 1280 that is a 229px translate plus 41px of
 * growth on a line box of 81: a letter falling through three lines of its own
 * headline, which is what it did in production. The gain is right for the
 * common case and cannot be right for both, so it stays, and CEILING below
 * bounds the other end.
 */
const DRAG = 1.9;
/** Extra stretch at full travel: 1 + this, applied about each letter's top. */
const STRETCH = 0.5;

/**
 * The lateral reach of the displacement field, in panel points.
 *
 * Everything above this line is one axis. A letter fell and got taller, and
 * that is the whole of what it did — which is a letter being SCALED, not a
 * letter in a liquid. The liquid it hangs from does not work that way: a lobe
 * pushes the surface OUT, and the surface either side of it goes along.
 *
 * So the type takes a displacement FIELD off the same surface rather than one
 * number. Let `h(x)` be how far the edge hangs below rest. The lateral part is
 *
 *     u(x) = -SPREAD · h'(x)
 *
 * — negative, so both flanks of a crest move AWAY from it, which is the
 * outward part. `scaleX` is then not a second effect invented beside it: it is
 * that same field's own derivative, `1 + du/dx`, evaluated across the letter,
 * so a letter widens exactly where the field is spreading and gathers where it
 * converges. One field, read twice — where it carries the letter, and how much
 * it stretches what it carries. That is why the letters come apart around a
 * lobe instead of each sliding on its own.
 *
 * Stated in panel points, like every other length the physics uses, so it is
 * the same displacement at every viewport rather than the same pixel count.
 */
const SPREAD = 3.5;

/**
 * Half the distance the slope is measured over, in panel points.
 *
 * This has to be the LOBE's scale, not the letter's. Sampling `h` at a
 * letter's own two edges was the first version and it measured essentially
 * nothing: a letter is about eight points wide, a lobe is five or six times
 * that, and across eight points of a broad lobe the surface is flat. The
 * lateral push came out at five hundredths of a pixel — the field was there in
 * the arithmetic and invisible on the page. Fourteen points is a third of a
 * lobe: wide enough to read which way the surface is running, narrow enough
 * that two letters on opposite flanks of one lobe still disagree.
 */
const STENCIL = 14;

/**
 * The lean, as a fraction of the surface's slope.
 *
 * `skewX` rather than `rotate`, and not for taste: skew maps y to y, so it
 * adds NOTHING to how deep the letter's ink reaches. The ceiling below is
 * computed from that depth. A rotation would have to be folded into it —
 * width/2 · sin θ — and a lean that changes what a letter is allowed to do
 * vertically is a lean that can re-open the collision the ceiling exists to
 * close.
 */
const TILT = 0.18;

/**
 * How much of the vertical stretch also goes into the width.
 *
 * The first version of this constant had the opposite sign: a third of a real
 * area-preserving squash, on the theory that narrowing under stretch is what
 * makes an elongation read as PULLED rather than scaled. It does — and it is
 * the wrong reading here. Where the surface hangs deep the liquid has pushed
 * outward, and a letter carried by it that answers by getting thinner is
 * moving against the thing it is supposed to be part of.
 *
 * So it swells, and by less than it lengthens: at full travel the letter is
 * half again as tall and about a sixth wider, which is anisotropic enough to
 * still read as a direction rather than as a zoom.
 */
const SWELL = 0.45;
/**
 * The travel that counts as "full", as a fraction of the crop's width. Sets
 * where the stretch saturates; smaller means the type reaches its full
 * elongation on a lighter transient.
 */
const FULL_TRAVEL = 0.022;
/** Buckets across the crop. The surface is smooth; this resolves it comfortably. */
const BUCKETS = 96;
/**
 * Air left under a dragged letter, as a fraction of the room it has.
 *
 * The room is measured — ink bottom of this line to ink top of the next — so
 * spending all of it means the two lines touch exactly, and "exactly" is not a
 * thing to leave to a font's hinting. A tenth back is the difference between
 * nearly touching, which reads as tension, and merging, which reads as a bug.
 */
const CEILING = 0.9;
/**
 * The last line has no line under it, so its ceiling is whatever sits below the
 * headline — the retracted band and the button in it — less this much breathing
 * room, and never more than one line box however tall the sheet is.
 */
const FLOOR_MARGIN = 10;
const LAST_LINE_MAX = 1.0;

/**
 * The lower edge of an outline, per x bucket, in panel points.
 *
 * The outline is a closed ring, so a given x is crossed twice — once on the way
 * out along the top and once coming back along the bottom. Taking the maximum y
 * per bucket keeps the bottom, which is the edge the type hangs from.
 *
 * Exported for `theTypeWarpsWithTheSurface`, which drives `render` outside a
 * browser: everything it asserts is a difference between this profile and the
 * resting one, so it has to bin the resting outline exactly as `layout` does
 * rather than by a second description of the same binning.
 */
export function lowerEdge(points, x0, x1) {
  const edge = new Float64Array(BUCKETS).fill(-Infinity);
  const span = x1 - x0;
  for (const p of points) {
    const t = (p.x - x0) / span;
    if (t < 0 || t > 1) continue;
    const i = Math.min(BUCKETS - 1, Math.floor(t * BUCKETS));
    if (p.y > edge[i]) edge[i] = p.y;
  }
  // A bucket the outline never crossed inherits its nearest neighbour, so the
  // profile is defined everywhere even where the liquid has pulled away.
  let last = -Infinity;
  for (let i = 0; i < BUCKETS; i++) {
    if (edge[i] === -Infinity) edge[i] = last;
    else last = edge[i];
  }
  last = -Infinity;
  for (let i = BUCKETS - 1; i >= 0; i--) {
    if (edge[i] === -Infinity) edge[i] = last;
    else last = edge[i];
  }
  return edge;
}

export class InkType {
  /**
   * @param {HTMLElement} headline the h2 to split and drive
   * @param {object} view the ReservoirView whose surface this type hangs from
   * @param {HTMLElement} [floor] whatever sits below the headline and must not
   *   be reached — the retracted band. Omitted, the last line gets one line box.
   */
  constructor(headline, view, floor = null) {
    this.headline = headline;
    this.view = view;
    this.floor = floor;
    this.letters = [];
    this.lines = [];
    this.rest = null;
    this.split();
  }

  /**
   * Rebuild the headline as one span per character.
   *
   * The original text is kept verbatim in a visually-hidden copy and the split
   * copy is hidden from the accessibility tree, which is the settled pattern for
   * per-letter animation: a screen reader reads one heading, not twenty-four
   * one-character ones. If this module never runs — the script fails, the
   * browser is old, JS is off — the markup it replaces is still the plain
   * headline, so the page loses an effect rather than its title.
   */
  split() {
    // The authored line break is a typographic decision (the comment on the
    // markup says so), so it is preserved rather than re-wrapped.
    const lines = this.headline.innerHTML
      .split(/<br\s*\/?>/i)
      .map((s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    // Joined with a space, not concatenated. `textContent` drops the <br> and
    // gave "Music livesin the notch." to every screen reader — the one copy of
    // this headline that has to be right, because it is the only one left in the
    // accessibility tree once the split copy is hidden from it.
    const source = lines.join(' ');

    const hidden = document.createElement('span');
    hidden.className = 'visually-hidden';
    hidden.textContent = source;

    const shown = document.createElement('span');
    shown.className = 'headline__ink';
    shown.setAttribute('aria-hidden', 'true');

    for (let l = 0; l < lines.length; l++) {
      if (l) shown.appendChild(document.createElement('br'));
      for (const ch of lines[l]) {
        const span = document.createElement('span');
        span.className = 'headline__letter';
        // A space cannot carry a transform box of its own, and a run of
        // non-breaking spaces would defeat the line break above.
        span.textContent = ch;
        if (ch === ' ') span.style.whiteSpace = 'pre';
        // Which line this letter is on decides how far it may fall.
        span._line = l;
        shown.appendChild(span);
        this.letters.push(span);
      }
    }
    this.lines = lines;

    this.headline.textContent = '';
    this.headline.appendChild(hidden);
    this.headline.appendChild(shown);
  }

  /**
   * Measure where each letter sits against the liquid's crop, and what the
   * surface looks like at rest.
   *
   * Called on every layout rather than every frame: this is the only part that
   * touches geometry, and doing it per frame would interleave reads with the
   * writes in `render` and thrash layout on a plate that is already painting
   * six canvases.
   */
  layout() {
    const view = this.view;
    if (!view || !view.canvas) return false;
    const box = view.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return false;

    // Measure at rest. A resize — or the webfont swap that calls this a second
    // time — can land mid-song, with every letter carrying a translate and up
    // to half again its own height in scaleY, and a rect reports the
    // TRANSFORMED box. Measured through that, the line box comes back inflated,
    // the room derived from it is generous by tens of pixels, and the ceiling
    // that room feeds would re-permit the very collision it exists to stop.
    // `render` puts the transforms back on the next frame; one frame at rest is
    // not a thing anyone sees, and a wrong room persists until the next resize.
    this.still();

    this.scale = view.scale;
    this.cropX = view.viewport.x;
    this.cropWidth = view.viewport.width;
    this.canvasLeft = box.left;

    // Where the surface sits with the music switched off. Everything below is
    // measured as a departure from this, so a still page holds still.
    const restOutline = view.restOutline && view.restOutline();
    this.rest = restOutline
      ? lowerEdge(restOutline, this.cropX, this.cropX + this.cropWidth)
      : null;

    for (const span of this.letters) {
      const r = span.getBoundingClientRect();
      // The letter's centre, expressed in the crop's own 0..1 span, and its
      // width in both units. The width is the stencil every reading in
      // `render` is taken over: the surface is sampled at this letter's own
      // two edges, so a wide letter smooths the profile over more of it than a
      // narrow one does, which is the right amount of smoothing by
      // construction rather than by a chosen radius.
      span._t = (r.left + r.width / 2 - box.left) / box.width;
      span._w = r.width / box.width;
      span._px = r.width;
    }
    this.measureRoom();
    return true;
  }

  /**
   * How far each letter may fall before it lands on the line beneath it.
   *
   * Boxes are useless for this: with `line-height` at 0.96 the lines stack edge
   * to edge, so box-to-box there is exactly zero room and any drop at all would
   * be forbidden. What is actually free is the LEADING — the air between one
   * line's ink and the next line's ink — and the only honest source for where
   * the ink sits inside a box is the font itself. Canvas is asked, with the
   * headline's own computed font, rather than a ratio being assumed: Archivo's
   * caps do not sit where a generic 0.7-of-em rule would put them, and the
   * whole point of this measurement is that it survives a change of face.
   */
  measureRoom() {
    const first = this.letters[0];
    if (!first) return;
    const boxH = first.getBoundingClientRect().height;
    if (!boxH) return;

    const style = getComputedStyle(this.headline);
    const ctx = (this.probe ||= document.createElement('canvas').getContext('2d'));
    // `font-stretch` cannot be expressed in the canvas shorthand, so the width
    // axis is lost here. It is a WIDTH axis: nothing below reads a horizontal
    // measurement, so the vertical metrics are the face's own either way.
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

    const ink = this.lines.map((text) => {
      const m = ctx.measureText(text);
      const ascent = m.fontBoundingBoxAscent;
      const descent = m.fontBoundingBoxDescent;
      const inkUp = m.actualBoundingBoxAscent;
      const inkDown = m.actualBoundingBoxDescent;
      if (![ascent, descent, inkUp, inkDown].every(Number.isFinite)) return null;
      // Half-leading centres the font's own box inside the line box, which is
      // how an inline box is positioned; the baseline follows from it.
      const baseline = (boxH - (ascent + descent)) / 2 + ascent;
      return { top: baseline - inkUp, bottom: baseline + inkDown };
    });

    // Below the last line is whatever the page put there. Measured live, so a
    // phone — where the retracted band sits a clamped 28px under the headline
    // rather than a screen away — gets a ceiling that reflects that.
    let below = boxH * LAST_LINE_MAX;
    if (this.floor) {
      const lastLetter = this.letters[this.letters.length - 1];
      const gap = this.floor.getBoundingClientRect().top
        - lastLetter.getBoundingClientRect().bottom;
      below = Math.max(0, Math.min(boxH * LAST_LINE_MAX, gap - FLOOR_MARGIN));
    }

    for (const span of this.letters) {
      const here = ink[span._line];
      const next = ink[span._line + 1];
      if (!here) { span._room = 0; span._inkBottom = boxH; continue; }
      span._inkBottom = here.bottom;
      span._room = next
        ? (boxH - here.bottom + next.top) * CEILING
        : (boxH - here.bottom + below) * CEILING;
    }
  }

  /** One frame: every letter takes the surface's travel directly above it. */
  render() {
    const view = this.view;
    if (!view || !view.outline || !this.rest) return;
    const edge = lowerEdge(view.outline, this.cropX, this.cropX + this.cropWidth);
    const scale = view.scale;

    /** One bucket's departure from rest, in CSS pixels, never negative: the
     *  type hangs FROM the surface and does not get pushed up by it. */
    const bucket = (i) => {
      const at = i < 0 ? 0 : i > BUCKETS - 1 ? BUCKETS - 1 : i;
      const restY = this.rest[at];
      if (!Number.isFinite(restY) || !Number.isFinite(edge[at])) return 0;
      return Math.max(0, edge[at] - restY) * scale;
    };

    /**
     * How far the surface hangs below rest at a point across the crop, in CSS
     * pixels, interpolated between bucket centres. Clamped at the ends rather
     * than dropped, so a letter whose edge falls off the crop reads the
     * nearest profile the liquid has instead of a hole.
     *
     * Interpolated, and it has to be. Read bucket by bucket this profile is a
     * staircase, and every reading below is a DIFFERENCE across it: a letter
     * is about three buckets wide, so a step landing inside one put the whole
     * jump into that letter's `flow` while its neighbours saw none of it, and
     * the two stopped agreeing about where their shared edge was. That is nine
     * pixels of overlap in the middle of a word, and it was there before
     * anything asked the type to move sideways — the old code simply never
     * differenced this profile, so a staircase was good enough for it.
     */
    const hangAt = (t) => {
      const u = t < 0 ? 0 : t > 1 ? 1 : t;
      const x = u * BUCKETS - 0.5;
      const i = Math.floor(x);
      const f = x - i;
      return bucket(i) * (1 - f) + bucket(i + 1) * f;
    };

    // The surface's slope at a point, dimensionless, measured over the lobe's
    // scale rather than the letter's — see `STENCIL`.
    const reach = STENCIL / this.cropWidth;
    const slopeAt = (t) => (hangAt(t + reach) - hangAt(t - reach)) / (2 * STENCIL * scale);
    // The field itself, in CSS pixels, pointing away from whatever the surface
    // is hanging deepest on.
    const fieldAt = (t) => -SPREAD * scale * slopeAt(t);

    // Two passes. Everything a letter does on its own is settled first; the
    // one thing it cannot settle alone is how far the swelling of its
    // NEIGHBOURS has pushed it along the line, and that is the second pass.
    const shaped = [];

    for (const span of this.letters) {
      const t = span._t;
      // Every letter gets an entry, including the ones the surface is doing
      // nothing to. A letter dropped out of this list is a letter dropped out
      // of its line's spread chain below — and then its neighbours' swelling
      // has nowhere to go and grows straight through it. That is not
      // hypothetical: `theTypeWarpsWithTheSurface` found nine pixels of
      // overlap between two letters, one of which was standing in a quiet
      // stretch of surface and had been skipped.
      const entry = { span, drop: 0, grow: 1, flow: 0, swell: 0, lean: 0, push: 0, k: 1, width: span._px || 1 };
      shaped.push(entry);
      if (!(t >= 0) || t > 1) { span.style.transform = ''; continue; }

      // The field at this letter's own two edges. Both readings below come out
      // of these two numbers and nothing else, which is what makes the tiling
      // exact rather than approximate — see `flow`.
      const half = (span._w || 0) / 2;
      const before = fieldAt(t - half);
      const after = fieldAt(t + half);

      const middle = hangAt(t);
      const push = (before + after) / 2;
      if (middle < 0.05 && Math.abs(push) < 0.05) { span.style.transform = ''; continue; }
      // The ceiling is a floor under this letter. With none, it may still be
      // carried sideways by what its neighbours are doing, but it does not fall.
      const room = span._room;
      if (!(room > 0)) { span.style.transform = ''; continue; }

      const drop = middle * DRAG;
      // The stretch is keyed to the same travel, so a letter that moves a long
      // way also elongates — one cause, two readings of it, which is what makes
      // it look pulled rather than merely translated.
      const grow = 1 + Math.min(1, middle / (this.cropWidth * scale * FULL_TRAVEL)) * STRETCH;

      const width = span._px || 1;
      // Two separate widenings, and they are kept separate because each one is
      // paired with the displacement that makes room for it.
      //
      // `1 + du/dx`, taken as the field's own difference across this letter, is
      // paired with `push`: displace a row of adjacent boxes by the MEAN of
      // the field at their two edges and scale each by the field's difference
      // across them, and neighbours agree about their shared edge exactly —
      // one letter's right edge and the next letter's left edge are the same
      // sample, so the two terms telescope and the row tiles however the field
      // curves. Taking `push` from the letter's centre instead, which is the
      // obvious way to write it, is right only where the field is straight:
      // near a lobe's crown the curvature is enough to put nine pixels of
      // overlap between two letters in the middle of a word.
      const flow = (after - before) / width;
      // The swell has no such partner — it is keyed to the vertical travel,
      // not to a horizontal field — so on its own it widens every letter into
      // its neighbour. It is given one below: `spread` is the running sum of
      // what the swell added to everything between this letter and the middle
      // of its line, which pushes the line apart by exactly as much as it grew.
      const swell = SWELL * (grow - 1);
      // The lean, as a tangent, from the same slope.
      const lean = TILT * slopeAt(t);

      // What the letter's INK bottom would do, which is the thing that collides.
      // The origin is the box top, so a point at depth d lands at d * grow: the
      // ink bottom falls by the translate plus (grow - 1) of its own depth. The
      // three lateral terms are absent from this on purpose — a skew maps y to
      // y, and neither a horizontal shift nor a horizontal scale moves a point
      // down the page, so none of them can reach the line below.
      const want = drop + (grow - 1) * span._inkBottom;
      // tanh, not a clamp. A clamp is a hard corner — every letter past the
      // limit sits at exactly the same depth, so a loud passage flattens the
      // whole line into one rigid step and the effect stops reading as liquid
      // at the moment it should read most. tanh is the identity for small
      // arguments, so the common case is untouched, and it approaches the
      // ceiling without ever reaching it, so the extremes stay ordered: a
      // deeper lobe still pulls its letter further than a shallower one.
      //
      // Applied to what FALLS, and only to that. The ceiling is a floor under
      // the letter, and a floor stops a letter descending; it does not stop it
      // sliding along or leaning over, neither of which can reach the line
      // below. Damping those too was the first version, and it cost the top
      // line everything: its room is the leading, which is a few pixels, so k
      // came out near zero and the first line sat rigid through a passage that
      // had the second one pouring. Held up from underneath, a liquid does not
      // go still — it shears. So `push`, `flow` and `lean` are undamped, and
      // the two terms keyed to the vertical travel, `swell` and the `spread`
      // that makes room for it, are damped with it.
      const k = want > 0 ? (room * Math.tanh(want / room)) / want : 1;

      Object.assign(entry, { drop, grow, flow, swell, lean, push, k });
    }

    // The room each letter's swelling takes out of the line, and where that
    // leaves it. The headline is centred, so the line grows about its own
    // middle: a letter's shift is everything the swell added between it and
    // that middle, which is what makes a lobe under one word carry the words
    // either side of it outward rather than widening one letter into the next.
    for (let line = 0; line < this.lines.length; line++) {
      const own = shaped.filter((s) => s.span._line === line);
      let total = 0;
      for (const s of own) total += s.width * s.swell * s.k;
      let run = 0;
      for (const s of own) {
        const added = s.width * s.swell * s.k;
        s.spread = run + added / 2 - total / 2;
        run += added;
      }
    }

    for (const s of shaped) {
      const x = s.push + s.spread;
      // A letter with nothing on any channel keeps the empty transform the
      // first pass gave it, rather than a written-out identity: the stylesheet
      // has its own opinion about a letter at rest and this should not overrule
      // it with a transform that happens to mean the same thing.
      if (x === 0 && s.drop === 0 && s.lean === 0 && s.flow === 0 && s.grow === 1) continue;
      s.span.style.transform =
        `translate(${x.toFixed(2)}px, ${(s.drop * s.k).toFixed(2)}px) `
        + `skewX(${(Math.atan(s.lean) * 180 / Math.PI).toFixed(2)}deg) `
        + `scale(${(1 + s.flow + s.swell * s.k).toFixed(3)}, ${(1 + (s.grow - 1) * s.k).toFixed(3)})`;
    }
  }

  /** Put every letter back where the stylesheet had it. */
  still() {
    for (const span of this.letters) span.style.transform = '';
  }
}
