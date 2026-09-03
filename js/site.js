// Driving the page.
//
// One simulation, two cameras: the notch open and the notch shut. They are two
// views of the SAME `FerrofluidSim` rather than two simulations, because the
// page shows them within a screen of each other and the cheapest way to be
// honest about that is to make disagreement impossible.
//
// The input is not synthesised. `REAL_LEVELS` is 240 frames captured from the
// app's own audio tap, replayed at the 30 Hz it was captured at and stepped
// twice apiece at 60 — which is what the app does with them, and what this file
// spent its whole existence not doing. It said 60 Hz here, indexed at 60 Hz
// below, and played eight seconds of music in four. See `CAPTURE_HZ`. The ink
// is displaced by the same numbers that displace it on the machine, at the same
// pace; the one deliberate difference is the low pass, and `SMOOTH_TAU` says
// why a page five times the size of a menu bar needs one.

import { FerrofluidSim, mulberry32 } from './sim.js';
import { INK, ReservoirView } from './render.js';
import { InkType } from './inktype.js';
import { REAL_LEVELS, LOOP_FRAME } from '../data/real-levels.js';
import { bankSteps, replayFrame, replayCadence, smoothStep, driveStill } from './clock.js';
import { shouldDraw, applyWatch, filmTransport, prefersReducedMotion } from './visibility.js';
import { LevelPump } from './bands.js';

/**
 * The rate the capture was TAKEN at, which is not the rate the page draws at.
 *
 * This was 60, and 60 was wrong. `AudioLevels.swift` pumps its read loop on
 * `Task.sleep(for: .milliseconds(33))` — the class comment beside it says "30
 * times a second" and the tap's own says "roughly 30 times a second" — so the
 * `[levels]` lines that `NOTCH_AUDIO_DEBUG` prints, which are byte-for-byte the
 * format of `Resources/real-levels.txt`, arrive at 30Hz. The commit that added
 * the capture (cefd7f7) says so outright: "the clock runs at 60Hz while levels
 * arrive at 30, so every second step sees a delta of exactly zero", and
 * `tools/fluidcheck.swift` steps each captured frame TWICE for that reason. The
 * pump was already 33ms at that commit, so this was never 60.
 *
 * Indexing at 60 played eight seconds of music in four. Everything downstream
 * inherited it: the loop period was reported as 3.567s and is 7.133s, the
 * entrance landed at 1.72s instead of the 3.43s of the music it claims to be
 * caused by, and `SMOOTH_TAU` was added below to quiet a "jitter" that was the
 * double speed. The page's own header said the ink is "displaced by the same
 * numbers that displace it on the machine", and it was displaced by the same
 * numbers at twice the pace.
 *
 * `theCaptureIsReplayedAtItsOwnRate` reads the pump interval out of
 * AudioLevels.swift and fails if these two ever disagree again.
 */
const CAPTURE_HZ = 30;

/**
 * The rate the PHYSICS is stepped at, which is the app's render clock.
 *
 * Two constants because they are two facts. The app runs `TimelineView` at
 * 1/60 and reads whatever `bands` currently holds, so a captured frame is
 * stepped twice and the second step sees no change — that stepped, held input
 * is the sequence the shipping fluid actually integrates, and it is what the
 * page reproduces now that the index advances at 30.
 */
const SIM_HZ = 60;


/**
 * The frame the still is held on under Reduce Motion.
 *
 * The preference asks for no motion; it does not ask for a different picture.
 * The page used to answer it with silence — the resting outline, which is a
 * flat pill — so the one visitor who cannot watch the liquid move was also the
 * one shown that it never does. This advances a seeded sim through the app's
 * own capture to a frame with the surface standing displaced and paints that,
 * once.
 *
 * Chosen by rendering candidates and looking at them — and looked at again once
 * the replay's cadence was corrected, because the first pass chose off a sim
 * stepped ONCE per captured frame, which is not the sequence the loop below
 * integrates. 110 survived that second look: across the capture it still
 * carries a wave train along its lower edge with a tapered fall at each end,
 * where its neighbours give up one or the other.
 *
 * The margin is small, and the reason is `reduceMotion` on the sim: Geometry's
 * `reducedTravel` caps the excursion, so nothing in this capture crowns
 * dramatically under the preference. What the choice buys is an edge that
 * undulates and ends that taper instead of the flat pill — not a peak.
 */
const STILL_FRAME = 110;
/** Fixed, so the still is the same still on every load and every resize. */
const STILL_SEED = 9;
const PANEL = { width: 640, height: 190 };
const NOTCH = { width: 185, height: 32 };
/** Pointer reach, in panel points. A broad pull; it cannot resolve finer. */
const REACH = 70;

/**
 * The hero's crop, in panel points.
 *
 * These four numbers are the camera. The scale comes from the box's height
 * (`fitHero`), the box's height comes from the type size (`--hero-type`), and
 * what the sheet is wide enough to show of the 264 points across is what it
 * shows: all of them at a desk, where the notch reads as a shape with ground
 * either side, and fewer on a phone, where the ink runs off both edges and the
 * words sit in a black field.
 *
 * This used to frame 200 points, on the argument that the last thirty at each
 * end "only ever hold the outermost slope of a lobe at full stretch". Measured
 * against the real geometry over the whole capture, the liquid reaches 188.3
 * to 445.4 with no pointer at all, and 181.8 to 456.8 with one — so the crop
 * was cutting 32 points off the left and 25 off the right of a shape that was
 * never smaller than the frame. Even SHUT it ran from 213.9 to 425.0 and hung
 * over both edges. There was never any ground beside the ink, at any width;
 * above roughly 1300px, where the box stops growing and the canvas becomes
 * narrower than the sheet, the liquid simply ended in a dead-straight vertical
 * line with page either side of it. A notch is a shape with ends.
 *
 * So: 176 to 456. The captured body has at least ten points of ground at each
 * end, enough to keep the six-point contact blur inside the camera. The live
 * analyser can drive the body farther than the capture: the old right edge at
 * 448 was reached during Chrome Funk even without a pointer, which turned the
 * curve into a vertical cut for a frame. The extra eight points are the
 * smallest camera change that clears that excursion and its shadow without
 * making the hero materially smaller.
 *
 * `y: -8` puts the display's top edge eight points down, so the notch's 32 sit
 * at 8..40 of the 72 this window frames, and its centre — where the headline
 * goes — at 24. `theHeroHangsFromTheDisplaysEdge` recomputes all three of
 * those fractions from here; `theHeroFramesTheWholeLiquid` recomputes the
 * extent above.
 */
const HERO_WINDOW = { x: 176, y: -8, width: 280, height: 72 };

/**
 * The retracted crop.
 *
 * Shut, nothing the liquid does may leave the menu-bar band, so the picture is
 * the band. Wide — 400 points of it, more than twice the hero's crop — because
 * the point being made is a proportion: the notch is a small dark island in a
 * bar that runs the width of the display, and a crop crowded around the pill
 * makes it look like the main event instead.
 *
 * The height is the band's, exactly: from 8 points above the display's top edge
 * to the 32 where the menu bar ends. The stylesheet draws that last edge as a
 * hairline under the picture, so the number here and the rule there have to be
 * the same edge — at 52 they were not, and the liquid floated 12 points above a
 * line it is supposed to be sitting on.
 *
 * These four numbers are also the download button's box. `.notch-button` is
 * laid over the notch's own cutout as a fraction of this crop, so moving any of
 * them moves the button; `theButtonSitsOnTheCutout` in portcheck recomputes the
 * stylesheet's fractions from here and fails if the two drift apart.
 */
const IDLE_WINDOW = { x: 120, y: -8, width: 400, height: 40 };

/**
 * Time constant on the drive, in seconds.
 *
 * This said "the capture is a 60 Hz tap and it is BUSY — every frame is a new
 * number", and both halves were wrong: the capture is 30Hz, and once it is
 * indexed at 30 each frame is held for two steps, so half the steps are a new
 * number and the other half are the same one. The chatter it was added to quiet
 * was the double speed. That would make this a compensation for a bug that has
 * since been fixed, and the honest move looked like deleting it.
 *
 * It is not, and the reason is scale. `--hero-height` draws a 72-point camera
 * window at up to 378px, so the page magnifies the app's own motion 5.25 times.
 * Measured over the whole capture — the furthest any point of the outline moves
 * between one step and the next, worst over all steps and mean over all steps,
 * in hero pixels — with this low pass 25px and 5.2px, without it 47px and
 * 13.2px. Thirteen pixels every sixtieth of a second is a surface that
 * flickers; the same motion in the app's 32-point menu bar is two and a half
 * points, which reads as liquid. The app does not need this because the app is
 * small.
 *
 * The measurement is stated as a method and not just as four numbers because
 * the four that were here before could not be reproduced by any reading of the
 * sentence that carried them. They were taken when the capture was believed to
 * be a 60Hz tap, which integrated the same music over half the time, and they
 * survived the correction the way the hero's extents did — quoted, never
 * recomputed. Comments do not have gates. This one at least says what to run.
 *
 * So it stays, as a first-order low pass on the levels going in — the same
 * numbers, arriving less abruptly. Peaks still break; they stop chattering. The
 * physics below it is untouched, and this is the one place the page is
 * knowingly not the app: `theReplayIsSteppedLikeTheApp` proves the port under
 * the app's cadence with the levels raw, and then the page smooths them.
 */
const SMOOTH_TAU = 0.11;

/**
 * Live audio is already attack/release metered by `BandAnalyser`. Reusing the
 * replay's 110ms filter made the enlarged ink feel a beat behind the music;
 * this shorter pass keeps the hero continuous without masking new hits.
 */
const LIVE_SMOOTH_TAU = 0.035;

/**
 * The three numbers above, turned into the three the loops actually use.
 *
 * Once, and in `clock.js`, because every place that spelled `1 / SIM_HZ` or
 * `1 - Math.exp(-dt / SMOOTH_TAU)` was a copy — including the gate's, which
 * rebuilt all three from the three constants it read out of this file and so
 * agreed with a still that had drifted. See `replayCadence`.
 */
const CADENCE = replayCadence(SIM_HZ, CAPTURE_HZ, SMOOTH_TAU);

const reduceMotion = prefersReducedMotion(matchMedia('(prefers-reduced-motion: reduce)'));

const sim = new FerrofluidSim();
sim.setOpen(true);
sim.reduceMotion = reduceMotion;

const views = [];

const heroCanvas = document.getElementById('hero-band');
// `coreFill: INK`, so the open notch is ONE black. The app fills the cutout
// #000 because on real hardware it is a hole; here it is a picture, and #000
// against the ink's #0B0A0C drew a hard rounded-rect edge straight through the
// headline — the difference blend gives one white over the cutout and another
// over the liquid, and the descenders of "magnetized." cross the join. The band
// below keeps the app's #000: there the cutout is the download button.
const hero = heroCanvas && new ReservoirView(heroCanvas, {
  panel: PANEL, notch: NOTCH, viewport: HERO_WINDOW, lit: true, openness: 1, reduceMotion,
  coreFill: INK,
});
const heroEntry = hero ? { view: hero, sim, openness: () => 1, fit: fitHero } : null;
if (heroEntry) views.push(heroEntry);

const idleCanvas = document.getElementById('idle-band');
if (idleCanvas) {
  const view = new ReservoirView(idleCanvas, {
    panel: PANEL, notch: NOTCH, viewport: IDLE_WINDOW, lit: true, openness: 0, reduceMotion,
    // This crop shows the housing strip, and hardware has no pixels above the
    // display's edge — without the clip the core paints black through the
    // strip to the picture's top, and the button laid over it is cut off flat.
    clipAtDisplayTop: true,
  });
  views.push({ view, sim, openness: () => 0, fit: fitIdle });
}

// ── The film ────────────────────────────────────────────────────────────────
//
// The third camera is not a camera any more: mid-page the app plays ITSELF,
// screen-recorded, so the one thing the drawings cannot prove — that the
// product does this on real hardware — is footage rather than a claim.
// Playback is the page's decision, not the tag's: nothing in the markup
// self-starts, and the motion preference is asked before the element ever
// runs, so under Reduce Motion the film holds its still — its own open
// frame, the whole shape with ends, the frame the other two pictures do
// not show. Like the canvases, the film runs only near the viewport, on
// the same 200px apron the views observer uses, and a film nobody is
// beside is paused — the canvases' own frugality.
const film = document.getElementById('demo-film');
const filmToggle = document.querySelector('[data-demo-motion]');
const filmToggleLabel = filmToggle
  && filmToggle.querySelector('[data-demo-motion-label]');
if (film && !reduceMotion) {
  let filmUserPaused = false;
  const setFilmTransport = (playing) => {
    if (!filmToggle) return;
    filmToggle.dataset.playing = String(playing);
    if (filmToggleLabel) {
      filmToggleLabel.textContent = playing ? 'Pause demo' : 'Play demo';
    }
  };
  // Frame 0 is both the poster and the loop entry, so playback never jumps.
  // The delivery cut stays open throughout; it does not hide the product on
  // its own landing page.
  // A rejected play() is a browser declining, not a bug worth a broken page.
  const run = () => {
    if (!filmUserPaused) film.play().catch(() => {});
  };
  film.addEventListener('play', () => setFilmTransport(true));
  film.addEventListener('pause', () => setFilmTransport(false));
  if (filmToggle) {
    filmToggle.addEventListener('click', () => {
      filmUserPaused = !film.paused;
      if (filmUserPaused) film.pause();
      else run();
    });
  }
  if (typeof IntersectionObserver === 'function') {
    // Where the film sits relative to the visitor is the transport's own
    // memory, not a flag this closure keeps. It was a flag this closure kept,
    // and `beside = !record.isIntersecting` inverted the whole transport with
    // the gate green — so the state went where a mutant can reach it and this
    // file stopped naming `isIntersecting` at all.
    const transport = filmTransport();
    const near = new IntersectionObserver((entries) => {
      for (const record of entries) {
        // Both actions spelled out, rather than one and an `else`. The policy
        // returns one of two, and the gate reads the two off the policy and
        // requires each to be answered here — so dropping the pause is a
        // deletion the gate can see, not an absent branch it cannot.
        const action = transport.observe(record);
        if (action === 'play') run();
        if (action === 'pause') film.pause();
      }
    }, { rootMargin: '200px' });
    near.observe(film);
    // A browser that suspends the page can pause the film on its own — a
    // muted loop nobody pressed pause on. Coming back is the cue to press
    // play again, but only beside the film: offscreen it stays paused,
    // which is the observer's own economy.
    document.addEventListener('visibilitychange', () => {
      if (transport.revealed(document.hidden) === 'play') run();
    });
  } else {
    run();
  }
}

// ── The soundtrack ─────────────────────────────────────────────────────────
//
// Opt-in audio only. Once the listener presses play, the element is routed
// through the browser port of AudioTap and the page's existing simulation reads
// those live bands. If AudioWorklet is unavailable the music still plays and
// the page keeps its proven captured replay; a missing analyser never costs the
// visitor the control they actually pressed.
const soundtrack = document.querySelector('[data-soundtrack]');
const soundtrackAudio = soundtrack && soundtrack.querySelector('[data-soundtrack-audio]');
const soundtrackToggle = soundtrack && soundtrack.querySelector('[data-soundtrack-toggle]');
const soundtrackToggleLabel = soundtrack
  && soundtrack.querySelector('[data-soundtrack-toggle-label]');
const soundtrackCurrent = soundtrack
  && soundtrack.querySelector('[data-soundtrack-current]');
const soundtrackTracks = soundtrack
  ? [...soundtrack.querySelectorAll('[data-soundtrack-track]')]
  : [];
const soundtrackStatus = soundtrack && soundtrack.querySelector('[data-soundtrack-status]');

const livePump = new LevelPump();
const liveBands = new Float32Array(livePump.bands.length);
const liveSource = { levels(out) { out.set(liveBands); } };
let liveAnalyser = false;
let livePumpFrame = -1;
let soundtrackPlaying = false;
let soundtrackContext = null;
let soundtrackAnalyser = null;
let soundtrackAnalyserPromise = null;

function soundtrackAnnounce(message) {
  if (soundtrackStatus) soundtrackStatus.textContent = message;
}

function soundtrackTitle(button) {
  return button?.dataset.title || button?.textContent.trim() || 'soundtrack';
}

function setSoundtrackTransport(playing) {
  if (!soundtrackToggle) return;
  soundtrackToggle.setAttribute('aria-pressed', String(playing));
  soundtrackToggle.setAttribute('aria-label', playing ? 'Pause page audio' : 'Play page audio');
  if (soundtrackToggleLabel) {
    soundtrackToggleLabel.textContent = playing ? 'Pause page audio' : 'Play page audio';
  }
}

function selectedSoundtrack() {
  return soundtrackTracks.findIndex((button) => button.getAttribute('aria-checked') === 'true');
}

function selectSoundtrack(index, play = false) {
  if (!soundtrackAudio || soundtrackTracks.length === 0) return;
  const next = (index + soundtrackTracks.length) % soundtrackTracks.length;
  const button = soundtrackTracks[next];
  for (const candidate of soundtrackTracks) {
    candidate.setAttribute('aria-checked', String(candidate === button));
    candidate.tabIndex = candidate === button ? 0 : -1;
  }
  if (soundtrackCurrent) soundtrackCurrent.textContent = soundtrackTitle(button);
  if (soundtrackAudio.getAttribute('src') !== button.dataset.src) {
    soundtrackAudio.src = button.dataset.src;
    soundtrackAudio.load();
  }
  liveBands.fill(0);
  livePump.bands.fill(0);
  livePumpFrame = -1;
  soundtrackAnnounce(`Selected ${soundtrackTitle(button)} by Punch Deck.`);
  if (play) playSoundtrack();
}

function enableSoundtrackAnalyser() {
  if (!soundtrackAudio) return Promise.resolve(false);
  if (soundtrackAnalyserPromise) return soundtrackAnalyserPromise;

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || typeof AudioWorkletNode !== 'function') return Promise.resolve(false);

  soundtrackContext = new AudioContext();
  const source = soundtrackContext.createMediaElementSource(soundtrackAudio);
  source.connect(soundtrackContext.destination);
  soundtrackContext.resume().catch(() => {});

  soundtrackAnalyserPromise = soundtrackContext.audioWorklet
    .addModule('js/bands-worklet.js')
    .then(() => {
      soundtrackAnalyser = new AudioWorkletNode(soundtrackContext, 'bands');
      const silentSink = soundtrackContext.createGain();
      silentSink.gain.value = 0;
      source.connect(soundtrackAnalyser);
      soundtrackAnalyser.connect(silentSink).connect(soundtrackContext.destination);
      soundtrackAnalyser.port.onmessage = ({ data }) => {
        if (data && data.length === liveBands.length) liveBands.set(data);
      };
      liveAnalyser = true;
      return true;
    })
    .catch(() => false);
  return soundtrackAnalyserPromise;
}

function playSoundtrack() {
  if (!soundtrackAudio) return;
  // Both calls begin inside the button gesture. Waiting for the worklet module
  // before play() would spend the browser's transient user activation.
  enableSoundtrackAnalyser();
  soundtrackAudio.play().catch(() => {
    soundtrackAnnounce('The soundtrack could not start. Try Play again.');
  });
}

if (soundtrackAudio && soundtrackToggle) {
  soundtrackToggle.addEventListener('click', () => {
    if (soundtrackAudio.paused) playSoundtrack();
    else soundtrackAudio.pause();
  });
  soundtrackTracks.forEach((button, index) => {
    button.addEventListener('click', () => selectSoundtrack(index, true));
    button.addEventListener('keydown', (event) => {
      const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next += 1;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next -= 1;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = soundtrackTracks.length - 1;
      selectSoundtrack(next, true);
      soundtrackTracks[(next + soundtrackTracks.length) % soundtrackTracks.length].focus();
    });
  });
  soundtrackAudio.addEventListener('play', () => {
    soundtrackPlaying = true;
    setSoundtrackTransport(true);
    const button = soundtrackTracks[selectedSoundtrack()];
    soundtrackAnnounce(`Playing ${soundtrackTitle(button)} by Punch Deck.`);
  });
  soundtrackAudio.addEventListener('pause', () => {
    soundtrackPlaying = false;
    liveBands.fill(0);
    setSoundtrackTransport(false);
    if (!soundtrackAudio.ended) soundtrackAnnounce('Soundtrack paused.');
  });
  soundtrackAudio.addEventListener('ended', () => {
    selectSoundtrack(selectedSoundtrack() + 1, true);
  });
  soundtrackAudio.addEventListener('error', () => {
    soundtrackPlaying = false;
    setSoundtrackTransport(false);
    soundtrackAnnounce('This soundtrack track is unavailable.');
  });
}

// The headline hangs off the hero's own surface. Guarded, and deliberately so:
// this is the one effect on the page that rewrites markup, and a page that
// threw here would lose its title rather than an ornament. If the constructor
// fails the h1 is left exactly as it was authored.
const headline = document.querySelector('.headline');
// What sits below the headline and must not be reached. It was the foot; the
// demo sits above the foot now, so the demo is the ceiling under the letters
// — and on a page without one, the foot still is.
const floor = document.querySelector('.demo') || document.querySelector('.foot');
let inkType = null;
if (headline && hero && !reduceMotion) {
  try { inkType = new InkType(headline, hero, floor); } catch { inkType = null; }
}

/** The hero's scale is set by how deep its box is, so the type fits the ink. */
function fitHero(view) {
  const box = view.canvas.closest('.hero');
  const height = box && box.clientHeight;
  return height ? height / HERO_WINDOW.height : false;
}

/**
 * The retracted band is width-driven: it fills the column it sits in.
 *
 * Measured from the cell, not from the canvas's own parent. The parent is now
 * the frame the download button is positioned inside, and `resize()` writes
 * the canvas's CSS width — so a wrapper that took its width from its contents
 * would be handing this function back its own last answer, and the band would
 * lock at whatever width it was first laid out at, on every viewport and every
 * device pixel ratio after it. `.bar` is the middle track of the foot's grid
 * and has an explicit width, so it cannot take one from the picture inside it.
 */
function fitIdle(view) {
  const box = view.canvas.closest('.bar');
  const width = box && box.clientWidth;
  return width ? width / IDLE_WINDOW.width : false;
}

function layout() {
  // The device pixel ratio has to be part of the guard, not just the scale.
  // Dragging the window from a 2x display to a 1x one leaves the CSS size
  // identical, so a scale-only comparison skips `resize()` and the backing
  // store keeps the old ratio.
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  for (const entry of views) {
    const scale = entry.fit(entry.view);
    if (!scale) continue;
    if (Math.abs(scale - entry.view.scale) < 0.001 && entry.view.dpr === dpr) continue;
    entry.view.scale = scale;
    entry.view.resize();
  }
  // After the views resize, because it measures against the hero canvas's new
  // box and reads `view.scale` to convert panel points into CSS pixels.
  if (inkType) inkType.layout();
  // Setting any canvas's width — even to the value it already had — clears its
  // backing store, so whatever was on screen has to be put back. Under the
  // preference that is one still; otherwise it is the loop, which may have
  // been stopped by a hidden tab. On iOS Safari the toolbar collapsing during
  // the first scroll is a resize even though every measured box is identical,
  // and the epsilon guard above makes that case free.
  if (reduceMotion) renderStill();
  else if (!running) start();
}

/**
 * One frame of the real fluid, painted once and left there.
 *
 * A separate sim, seeded, so it cannot disturb the one the page owns and comes
 * out identical on every call — a resize has to repaint the same picture, not
 * a new one. `reduceMotion` on the sim is what caps the travel (Geometry's own
 * `reducedTravel`), so this is the app's answer to the preference and not a
 * second one invented here.
 */
function renderStill() {
  const still = new FerrofluidSim(mulberry32(STILL_SEED));
  still.reduceMotion = true;
  still.setOpen(true);
  // Stepped like the app: the clock is 1/60 and a captured frame is held for
  // two of them. Stepping once per frame at 1/CAPTURE_HZ would integrate the
  // same music over the same eight seconds and still be a different sequence —
  // one long step per level instead of a hit and then a held rest — and the
  // fluid's inputs are all measured against a remembered past, so the two do
  // not converge.
  //
  // The loop that says so is in `clock.js` and not here. It was here, as its
  // own spelling of `1 / SIM_HZ`, its own hold count and its own low pass, and
  // what held all three was the SHAPE of the lines rather than the picture they
  // painted: doubling the step moved this still's outline by 12.3 points on a
  // 190-point panel with all forty checks green. See
  // `theStillIsAFrameOfTheFilm`, which runs the walk against the replay's.
  driveStill(still, REAL_LEVELS, STILL_FRAME, CADENCE);
  for (const entry of views) entry.view.render(still, entry.openness());
  // And the type hangs from the surface that was just painted, because a still
  // where the liquid has crowns in it and the words are sitting flat is two
  // inks. The preference asked for no MOTION; a shape at rest in a shape is
  // not motion, and `render` reads the outline the line above just published.
  if (inkType) inkType.render();
}

/**
 * Only the drawing is gated, never the physics.
 *
 * A canvas that scrolls back into view shows the simulation the rest of the
 * page has been running rather than one that froze when it left.
 * `content-visibility: auto` would not do this: the draw calls come from
 * script, so the backing store is rasterised whether or not the browser ever
 * paints the element.
 */
if (typeof IntersectionObserver === 'function') {
  const watch = new IntersectionObserver((entries) => {
    // The records go straight to the policy, which writes the flags and says
    // whether the loop has to wake. Nothing here reads or writes `.onScreen`:
    // the assignment that used to sit in this callback could be inverted
    // without a single check noticing, and no text rule can hold an assignment
    // whose every identifier is free to be renamed. So it went to `applyWatch`
    // and this file's rule became an absence — it never writes the flag.
    const wake = applyWatch(entries, views, running);
    if (wake) start();
  }, { rootMargin: '200px' });
  for (const entry of views) watch.observe(entry.view.canvas);
}

// ── The replay ──────────────────────────────────────────────────────────────

let last = 0;
let running = false;
/** One physics step, in seconds. The app's clock, not the display's. */
const SIM_STEP = CADENCE.dt;
const LIVE_SMOOTH_K = 1 - Math.exp(-SIM_STEP / LIVE_SMOOTH_TAU);
/**
 * Wall time received but not yet spent as whole steps.
 *
 * A leftover of up to one step is carried rather than dropped, so a display
 * whose refresh does not divide 60 — 90Hz, or a 60Hz panel missing frames —
 * still spends every millisecond it is handed exactly once.
 */
let bank = 0;
/** Steps taken, as an integer, because `elapsed` derived from it cannot drift. */
let steps = 0;
/** Steps already integrated, so a callback advances the ones it added and no more. */
let stepsDrawn = 0;
/**
 * The frame the loop has already asked for, so `stop` can take it back.
 *
 * `frame` guards on `running`, which looks like enough and is not: a callback
 * queued before the tab was hidden is never SERVICED while it is hidden, so it
 * is still pending when the page comes back — and `start` sets `running` true
 * again in the same event, before that stale callback gets its turn. It then
 * finds the flag true, runs, and queues a successor of its own. One extra loop
 * per hide/show cycle, forever. The physics does not drift — the second
 * callback of a pair reads a dt of zero — so nothing looks wrong.
 */
let queued = 0;

/**
 * The captured frame driving a physics STEP — looping back to the quietest
 * captured frame rather than to the start.
 *
 * Takes the step, not the elapsed seconds. Converting the integer step counter
 * into seconds and back into a frame index put a float round trip between the
 * two, and it does not survive one: see `replayFrame` in clock.js, which is
 * where the arithmetic lives so a gate with no browser can drive the real
 * function rather than a copy of it.
 */
function frameNow(step) {
  return replayFrame(step, SIM_HZ, CAPTURE_HZ, REAL_LEVELS.length, LOOP_FRAME);
}

function levelsAt(step) {
  if (!liveAnalyser) return REAL_LEVELS[frameNow(step)];
  const pumpFrame = Math.floor(step / CADENCE.steps);
  if (pumpFrame !== livePumpFrame) {
    livePumpFrame = pumpFrame;
    livePump.tick(soundtrackPlaying ? liveSource : null);
  }
  return livePump.bands;
}

/**
 * The current drive, low-passed. Captured footage needs the full scale filter;
 * live audio has already passed through the app's own meter and gets only the
 * shorter continuity pass above.
 *
 * Both rates are computed once from `SIM_STEP`; recomputing either per call
 * would be another clock copy that could disagree with the still silently.
 */
const drive = new Array(REAL_LEVELS[0].length).fill(0);
function smoothed(target) {
  return smoothStep(drive, target, liveAnalyser ? LIVE_SMOOTH_K : CADENCE.k);
}

function frame(now) {
  if (!running) return;
  // Two clamps, for two different lies the clock tells. A tab restored after
  // minutes must not be handed that gap as one step — and the first callback's
  // timestamp is taken when the frame BEGAN, which can predate the reading
  // `start` just took, so the very first dt can arrive negative.
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
  last = now;
  // Banked, not spent. The step below is a FIXED 1/SIM_HZ and the display's
  // rate is nobody's business but the display's: a 120Hz panel delivers twice
  // the callbacks and must integrate the same fluid, not a finer one. It did
  // not — advancing by the wall's own dt made the physics a function of the
  // refresh rate, and on the ProMotion hardware this product is about that is
  // a different picture. Driven over this capture the way the defect drove it —
  // the drive low-passed per callback, the captured frame taken from elapsed
  // time — a 120Hz panel and a 60Hz one part company by 0.48 in site height at
  // worst, and only the 60Hz picture matches the golden that
  // `theReplayIsSteppedLikeTheApp` compares to.
  //
  // That figure was 0.372 and is stated as a method now, because 0.372 is not
  // reproducible: it belongs to the cadence where the capture was believed to
  // run at 60Hz, and no reading of it under the true 30Hz comes back under
  // 0.48. Eight variants were tried — smoothed and raw, the index taken from
  // elapsed time and from a held count — and the whole 30Hz family lands
  // between 0.48 and 0.58 while the 60Hz family lands between 0.36 and 0.39.
  // The number moved in the direction that matters: the divergence this banking
  // exists to prevent is LARGER than the comment claimed, so the note left to
  // justify the fix was quietly arguing against it.
  //
  // The tempo was never wrong here — the step count is spent wall time and the
  // index is taken from it — so this buys agreement, not pace. The clamp above
  // still does its two jobs; what it hands over is banked rather than
  // integrated. Whole steps only, and the remainder stays banked. In `clock.js`
  // rather than here so it can be driven at four refresh rates by a check that
  // has no browser — see `theReplayClockIsTheAppsClock`.
  ({ bank, steps } = bankSteps({ bank, steps }, dt, SIM_STEP));

  // One advance per whole step, so a captured frame gets exactly
  // SIM_HZ / CAPTURE_HZ of them however often the browser calls back, and the
  // smoothing runs on the same clock rather than on the callback's. The index
  // comes from `s` itself: handing `levelsAt` seconds broke that hold at step
  // 246 — frame 122 took three steps and 123 took one — while all 35 gates
  // stayed green. See `replayFrame` in clock.js.
  for (let s = stepsDrawn; s < steps; s++) {
    sim.advance(smoothed(levelsAt(s)), SIM_STEP);
  }
  stepsDrawn = steps;
  for (const entry of views) {
    if (!shouldDraw(entry.onScreen)) continue;
    entry.view.render(entry.sim, entry.openness());
  }
  // After the hero renders, never before: the type reads the outline that frame
  // actually drew, so asking for it first would hang the words off the previous
  // frame's liquid and put the headline permanently one tick behind the ink.
  // Wrapped, and it stays wrapped. An exception thrown in a rAF callback does
  // not just skip the effect — it takes the loop down with it, stopping every
  // canvas. One failure retires the effect and leaves the page running, which
  // is the right trade for something decorative.
  if (inkType && heroEntry && shouldDraw(heroEntry.onScreen)) {
    try { inkType.render(); }
    catch (error) { console.error('inktype retired:', error); inkType.still(); inkType = null; }
  }

  queued = requestAnimationFrame(frame);
}

function start() {
  // Under the preference there is no loop at all — not one that settles and
  // retires, which is what this used to do, but none. `renderStill` has
  // already painted the picture and nothing on the page can ask for another
  // frame: this is the one guard, and it covers `layout`, the intersection
  // observer and `visibilitychange` together.
  if (running || reduceMotion) return;
  running = true;
  last = performance.now();
  queued = requestAnimationFrame(frame);
}

function stop() {
  running = false;
  // Cancelling a handle that has already fired is defined to do nothing, which
  // is what makes this safe on the settle path above, where `stop` is called
  // from inside the very callback it is cancelling.
  cancelAnimationFrame(queued);
  queued = 0;
}

// ── Gestures ────────────────────────────────────────────────────────────────

if (hero && !reduceMotion) {
  // No instruction anywhere says to do this. The ink leaning toward the cursor
  // is the whole discovery, and a caption telling you to try it spends the
  // surprise it is describing.
  addEventListener('pointermove', (event) => {
    // The hero is the one drawn surface the pointer can reach: the film
    // mid-page carries its own recorded pointer and answers to nobody.
    const best = hero.rimAt(event.clientX, event.clientY);
    const strength = Math.max(0, 1 - best.distance / REACH);
    sim.setPointer(strength > 0 ? best.rim : null, strength);
  }, { passive: true });

  // On the documentElement, not on window. `pointerleave` does not bubble, and
  // a non-bubbling event is never dispatched at window at all — the listener
  // that used to live there could not fire, so the ink kept leaning at whatever
  // the last known cursor position was after the pointer had left the page.
  document.documentElement.addEventListener(
    'pointerleave', () => sim.setPointer(null), { passive: true });

  // The button is a place the liquid answers, not just a rectangle — and since
  // both canvases are cameras on one sim, the notch you reached for and the one
  // a screen above it heave on the same frame. Direction 0 because reaching for
  // a download is an event with no direction; +1 is what a skip forward gets,
  // and it piles the liquid at the end you skipped toward.
  const button = document.querySelector('[data-download]');
  if (button) {
    button.addEventListener('pointerenter', () => sim.surge(1, 0));
    // The keyboard gets the same answer, but only when the ring is showing. A
    // click focuses too, and answering twice for one gesture reads as a stutter.
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) sim.surge(1, 0);
    });
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else start();
});

addEventListener('resize', layout, { passive: true });

layout();
// The hero's height is set from the headline's type size, which is set in a
// webfont that had not arrived when `layout()` first ran. The epsilon guard in
// `layout` makes this a no-op when nothing moved.
if (document.fonts) document.fonts.ready.then(layout);
// `layout` has already painted whichever of the two the preference asked for.
start();
