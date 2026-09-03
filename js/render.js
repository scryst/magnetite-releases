// Painting one reservoir. Every view on the page is a separate render of the
// SAME sim state — the page claims they agree, so there is one simulation and
// many cameras on it rather than several simulations that would drift.
//
// The app fills a flat silhouette and needs no lighting, and this page keeps
// it that way: the ink is the app's flat black, grounded by a contact shadow
// on the plates that sit on paper. A rim specular lived here once — segment
// strokes along the lit half of the surface — and was cut on sight: sampled
// per segment it read as a dotted line of shine, an artifact, not a light.

import { Geometry, poolPath } from './geometry.js';
import { glowAlpha } from './sim.js';

// Safari before 16.4 and Firefox before 112 have no roundRect. Without this
// the first frame throws mid-paint — after the body fill, before the cutout —
// so the rAF loop dies with it and the page freezes on one half-painted band
// (and the Reduce Motion still aborts the module during init). arcTo draws the
// same corner. The typeof guard is for Node, where the port check imports this
// module with no canvas at all.
if (typeof CanvasRenderingContext2D !== 'undefined'
    && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    const radius = Math.min(Number(r) || 0, w / 2, h / 2);
    this.moveTo(x + radius, y);
    this.arcTo(x + w, y, x + w, y + h, radius);
    this.arcTo(x + w, y + h, x, y + h, radius);
    this.arcTo(x, y + h, x, y, radius);
    this.arcTo(x, y, x + w, y, radius);
    this.closePath();
    return this;
  };
}

export const INK = '#0B0A0C';
/**
 * The shadow the liquid casts on the sheet it sits on.
 *
 * A shadow is the ground seen through less light, so it has to be the ground's
 * own hue darkened — never a colour of its own. This was `rgba(193,51,10,0.22)`,
 * a warm shadow chosen for a fluorescent orange page, and on the grey it reads
 * as a salmon rim around every peak: the one place on the page where a colour
 * appears, and it is an artefact.
 */
export const CONTACT = 'rgba(24,26,31,0.20)';

/**
 * One canvas showing the reservoir at some scale and openness.
 *
 * `lit` plates get the contact shadow. The colophon does not: there the ink is
 * described only by the app's own halo, which is what a black liquid on a
 * black screen actually looks like.
 */
export class ReservoirView {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.notch = options.notch || { width: 185, height: 32 };
    this.panel = options.panel || { width: 640, height: 190 };
    // The part of the panel this camera shows, in panel points. Defaults to all
    // of it. The geometry is always the whole panel — this only decides how much
    // of the result gets a surface to land on, so a view that wants the liquid
    // and not the empty margins does not pay for pixels it clips away.
    this.viewport = options.viewport || { x: 0, y: 0, ...this.panel };
    this.scale = options.scale || 1;
    this.lit = options.lit !== false;
    this.tint = options.tint || '#FFFFFF';
    this.openness = options.openness ?? 0;
    // Retracted, nothing the fluid does may reach below the menu-bar band —
    // that space belongs to browser tabs and window chrome. Interpolated with
    // the shell rather than switched, exactly as the app clips it.
    this.clipToBand = options.clipToBand !== false;
    // Whether the display's own top edge clips the picture too. Hardware has
    // no pixels above that edge, but the geometry does: `core.y` is -30 and
    // the resting outline tops out at -6, so a camera whose crop starts above
    // zero shows both painted straight through the housing strip to the crop's
    // top — which is where the download button got its flat-cut head. Opt-in
    // per camera, never a change to the shared clip: the hero's bite through
    // the page's top edge is that picture's stated composition, and a global
    // clip would quietly rewrite it.
    this.clipAtDisplayTop = options.clipAtDisplayTop === true;
    // What the camera's cutout is filled with.
    //
    // The app fills it #000 and must: on real hardware that rect is a hole, and
    // black pixels are how the app promises never to draw into it. This page has
    // no hardware behind the picture, and the cutout in #000 against the ink's
    // #0B0A0C is an eleven-level step with a hard rounded-rect edge — an edge
    // that runs straight through the headline, because the words are knocked out
    // of the liquid by a difference blend and two backdrops give two whites. The
    // descenders of "magnetized." cross it, on the largest type on the site.
    //
    // Both whites are |backdrop − `--headline-source`|, so they MOVE with that
    // token and are quoted here at the one the stylesheet ships: (203,206,210)
    // over the #000 and (192,196,198) over the ink. They read (214,216,222) and
    // (203,206,210) while the source was `--screen` itself — which was its own
    // defect, and the token's comment says why. Recompute from the token; the
    // step between the two is the point, not the pair.
    //
    // So the two PICTURES of the open notch — the hero and the share card — fill
    // it with the ink and read as one continuous reservoir, which is what
    // PRODUCT.md asks the liquid to be. The retracted band keeps the #000,
    // because there the cutout is not a picture of a hole, it is the download
    // button, and the stylesheet paints the same #000 behind it so a page whose
    // script never arrived still has a black control.
    this.coreFill = options.coreFill || '#000000';
    this.reduceMotion = options.reduceMotion || false;
    this.quality = { contactShadow: true, samples: Geometry.outlineSamples };
    this.resize();
  }

  resize() {
    // Clamped at 2: past that the extra pixels cost real frames and buy nothing
    // on a surface this smooth.
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    this.dpr = dpr;
    const view = this.viewport;
    this.canvas.width = Math.round(view.width * this.scale * dpr);
    this.canvas.height = Math.round(view.height * this.scale * dpr);
    this.canvas.style.width = `${view.width * this.scale}px`;
    this.canvas.style.height = `${view.height * this.scale}px`;
  }

  /**
   * Where this camera puts panel coordinates on its own canvas: panel point p
   * lands at (p - viewport.origin) * scale * dpr.
   *
   * Pulled out of `render` so it can be asserted without a rasteriser. The
   * invariant worth protecting is that a camera only ever TRANSLATES — two
   * cameras on one sim must map the vector between any two panel points to the
   * same canvas vector, or the page is showing two fluids and claiming one.
   */
  cameraTransform() {
    const unit = this.dpr * this.scale;
    return { a: unit, d: unit, e: -this.viewport.x * unit, f: -this.viewport.y * unit };
  }

  /**
   * The outline with the music switched off, at this camera's openness.
   *
   * The same `poolPoints` call `render` makes, with every drive zeroed — so it
   * is the resting surface by construction rather than by a second description
   * of one. Cheap enough to call per layout and far too expensive per frame.
   */
  restOutline() {
    const geometry = new Geometry(this.notch, this.panel, this.openness);
    const { points } = geometry.poolPoints(
      (position, lateral, headroom, detail) => geometry.displacement({
        reduce: this.reduceMotion,
        position,
        lobes: geometry.lobes([]),
        swell: 0,
        raised: 0,
        lateral,
        detail,
        headroom,
        pointerRim: null,
        pointerPull: 0,
      }),
      { samples: this.quality.samples },
    );
    return points;
  }

  /** Project a client point onto the outline, as a rim fraction. */
  rimAt(clientX, clientY) {
    const box = this.canvas.getBoundingClientRect();
    const x = (clientX - box.left) / this.scale + this.viewport.x;
    const y = (clientY - box.top) / this.scale + this.viewport.y;
    const geometry = new Geometry(this.notch, this.panel, this.openness);
    let best = 0;
    let bestDistance = Infinity;
    // 48 is plenty to land within a third of a sample of the true nearest
    // point, and the pull is a broad Gaussian that cannot resolve better.
    for (let i = 0; i <= 48; i++) {
      const position = i / 48;
      const point = geometry.rim(position).point;
      const distance = (point.x - x) ** 2 + (point.y - y) ** 2;
      if (distance < bestDistance) { bestDistance = distance; best = position; }
    }
    return { rim: best, distance: Math.sqrt(bestDistance) };
  }

  render(sim, openness = this.openness) {
    this.openness = openness;
    const { ctx } = this;
    const inkOpen = Math.max(0, Math.min(openness, sim.inkOpen));
    const geometry = new Geometry(this.notch, this.panel, inkOpen);
    const lobes = geometry.lobes(sim.sites);

    const { points, normals } = geometry.poolPoints(
      (position, lateral, headroom, detail) => geometry.displacement({
        reduce: this.reduceMotion,
        position,
        lobes,
        swell: sim.swell,
        raised: sim.raised,
        lateral,
        detail,
        headroom,
        pointerRim: sim.pointerRim,
        pointerPull: sim.pointerPull,
      }),
      { samples: this.quality.samples },
    );
    const path = poolPath(points);
    // Published for anything that has to line up with the liquid rather than
    // merely sit near it. The hero's headline is dragged down by whatever the
    // surface is doing directly above each letter, and the only honest source
    // for that is the outline this frame actually drew — recomputing it from
    // the sim in a second place would be two answers to one question.
    this.outline = points;

    ctx.save();
    // Panel coordinates throughout, with the viewport's own corner as the
    // canvas origin — so every path below is written in the same numbers the
    // geometry produced, whatever this camera happens to be framing.
    const view = this.viewport;
    const t = this.cameraTransform();
    ctx.setTransform(t.a, 0, 0, t.d, t.e, t.f);
    ctx.clearRect(view.x, view.y, view.width, view.height);

    if (this.clipToBand) {
      // The same interpolating clip the app applies: at openness 0 this is the
      // menu-bar band exactly, at 1 the whole panel. The top is the display's
      // edge for a camera that asked for it, and otherwise far enough up that
      // nothing is cut.
      const above = this.clipAtDisplayTop ? 0 : 60;
      ctx.beginPath();
      ctx.rect(0, -above, this.panel.width,
        above + geometry.core.maxY + (this.panel.height - geometry.core.maxY) * inkOpen);
      ctx.clip();
    }

    if (this.lit) {
      if (this.quality.contactShadow) this.contactShadow(ctx, path);
      this.body(ctx, path, geometry);
    } else {
      this.halo(ctx, path, sim.impact, inkOpen);
      this.body(ctx, path, geometry);
    }

    ctx.restore();
    return { points, normals, geometry };
  }

  /**
   * The shadow, stated in ONE space.
   *
   * The offset is a `translate` inside the camera transform, so it is 3 by 4
   * PANEL POINTS and grows with the picture. `shadowBlur` is not transformed —
   * the canvas applies it in the output bitmap — so it was 10 device pixels at
   * every scale. Two numbers in two spaces, and the ratio between them is what
   * a shadow's softness IS.
   *
   * At the foot band, drawn at about 1.65 points to the pixel, that came to an
   * offset of five or six pixels under ten of blur: soft, and right. At the
   * hero, drawn at 5.25 and again by the device's 2, the same declaration came
   * to a 42-device-pixel offset under the same ten — a hard-edged flat slab of
   * CONTACT clear of the body on two sides, with a thin ramp at its edge. Not a
   * shadow: a second silhouette, in grey, behind the largest object on the page.
   * Measured down a column through the hem it was ninety-odd rows flat at
   * (170,172,178) before any falloff began.
   *
   * So the blur is multiplied into the same space as the offset, and the two
   * scale together. The picture is one object at two magnifications and its
   * shadow now behaves like one: same character in the band and in the hero,
   * which is the invariant, rather than the same pixel count at two sizes.
   */
  contactShadow(ctx, path) {
    ctx.save();
    // NO offset, and that is the whole fix.
    //
    // `fill` here paints a SOLID slab of CONTACT and the blur is the halo cast
    // by that slab. Offset the two together — `translate(3, 4)` — and the slab
    // itself escapes from behind the body by exactly that much, hard-edged,
    // before any falloff begins: 42 device pixels of flat grey under the hero,
    // ending in a 61-level cliff. A duplicate of the silhouette in grey, which
    // is what a jury saw and named.
    //
    // With the slab exactly under the body, the body covers every pixel of it
    // and the only thing that reaches the sheet is the blur. There is no edge
    // left to be hard. What that draws is not a cast shadow but the ground seen
    // through less light where the liquid meets it — which is what a body
    // resting ON a surface actually does, and this one is welded to the top of
    // the page rather than floating over it.
    ctx.shadowColor = CONTACT;
    ctx.shadowBlur = 6 * this.dpr * this.scale;
    ctx.fillStyle = CONTACT;
    ctx.fill(path);
    ctx.restore();
  }

  body(ctx, path, geometry) {
    // Flat. The app draws it flat and this page draws it flat: a gradient-filled
    // fluid is a different material.
    ctx.fillStyle = INK;
    ctx.fill(path);
    // The camera guarantee, crisp and outside everything else — nothing the
    // surface does is ever visible inside the cutout. The app draws this rect in
    // #000 and so does the band; the pictures of the open notch draw it in the
    // ink. See `coreFill`.
    ctx.fillStyle = this.coreFill;
    ctx.beginPath();
    ctx.roundRect(geometry.core.x, geometry.core.y,
      geometry.core.width, geometry.core.height, geometry.cornerRadius);
    ctx.fill();
  }

  /** The app's own halo, verbatim, for the one plate where the light is off. */
  halo(ctx, path, impact, openness) {
    const alpha = glowAlpha(impact, openness);
    if (alpha <= 0.002) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.filter = `blur(${11 + 14 * impact}px)`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = this.tint;
    ctx.fill(path);
    ctx.restore();
  }
}
