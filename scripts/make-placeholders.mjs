#!/usr/bin/env node
// scripts/make-placeholders.mjs - generate one typographic PLACEHOLDER image per
// event, so the events page has artwork that cannot be mistaken for a photograph
// that does not exist yet.
//
// ---------------------------------------------------------------------------
// WHAT THIS IS FOR
// ---------------------------------------------------------------------------
//
// data/events.json declares a `thumbnail` and a `banner` path per event. Every
// one of those paths is currently a promise, not a picture. A page that renders a
// broken image icon is ugly; a page that renders NOTHING is worse, because a row
// with no image reads as a design decision.
//
// So this script draws the stand-in, and the stand-in is built to be obviously
// provisional:
//
//   - the word PLACEHOLDER is set on every banner, in letterspaced capitals;
//   - the banner is typeset, not illustrated - no fake photo, no fake crowd;
//   - the thumbnail carries a date and nothing else.
//
// The date IS the useful part of a thumbnail at 72 pixels wide: the reader is
// scanning for when, not who. And the panel gives every image a border and a
// radius, so a typographic plate reads as a plate and not as a broken asset.
//
// ---------------------------------------------------------------------------
// WHY THE COLOURS ARE HARDCODED, AND WHY THAT IS NOT A BUG
// ---------------------------------------------------------------------------
//
// DO NOT "FIX" THIS BY MOVING THE COLOURS INTO themes.css.
//
// The values below are copied from the CIVIC palette in src/styles/themes.css -
// the light rendering, i.e. the first argument of each light-dark() - and they
// are hardcoded in this file on purpose.
//
// An SVG referenced by <img> is an ISOLATED DOCUMENT. It cannot read the page's
// CSS custom properties, and it cannot resolve currentColor: by specification it
// has no access to the embedding document's styles at all. So a placeholder that
// "follows the theme" is not possible without inlining a <style> block into every
// generated file and accepting that it would still not see the page's variables.
//
// That is not a defect to be engineered around. It is what a photograph does. A
// photograph dropped into public/img/ would not repaint when the reader switched
// to slate, and neither do these. The tokens here are the ones chosen so the
// plate sits correctly on the default theme; the panel's existing border and
// radius is what keeps it framed on the other three.
//
// If this ever does need to follow the theme, the honest form of that change is
// CSS on the consuming component (EventRow.astro / EventDetail.astro), never a
// custom property referenced from inside the SVG.
//
// ---------------------------------------------------------------------------
// SAFETY PROPERTIES, WHICH MATTER MORE THAN THE ARTWORK
// ---------------------------------------------------------------------------
//
// 1. NEVER OVERWRITE AN EXISTING FILE. If the target already exists it is skipped
//    and reported. A real photograph dropped in later MUST survive someone
//    re-running this script.
//
//    --force overwrites. --force WILL DESTROY REAL ARTWORK. It exists so that a
//    deliberate redesign can be re-applied, not so that an impatient person can
//    get a warning to go away. If you are typing --force, ask first whether the
//    file on disk is a photograph.
//
// 2. ONLY .svg PATHS ARE TOUCHED. If an event declares /img/events/foo.jpg, that
//    is a real photograph: skipped entirely, and said so.
//
// 3. A null thumbnail or banner is a MEANINGFUL ABSENCE, not an error. It is
//    reported and nothing is created. The schema models it, the components render
//    around it, and inventing a file for it would destroy information.
//
// 4. DETERMINISTIC. The same input produces byte-identical output. No timestamp,
//    no random, no locale-dependent formatting (month names come from the shared
//    MONTHS table, never from Intl or toLocaleDateString). This is design rule 8
//    and it is what makes the generated files reviewable in a diff.
//
// ---------------------------------------------------------------------------
// WHY IT DOES NOT GATE ON validateEvents
// ---------------------------------------------------------------------------
//
// scripts/check-events.mjs is the gate for data/events.json, and it runs the
// schema's whole-file validation. This script needs a different thing: the six
// or so fields below (id, name, startsAt, endsAt, thumbnail, banner), and
// tolerance for a file that is mid-edit by a human or an assistant.
//
// Duplicating the schema's rules here would give the project two answers to "is
// this dataset valid", and two answers is worse than one loose one. So this file
// validates ONLY what it is about to draw from, says loudly which field was
// unusable, and leaves whole-file validation to `npm run events:check`.
//
// ---------------------------------------------------------------------------
// TEXT RENDERING, AND WHY IT IS THIS WAY
// ---------------------------------------------------------------------------
//
// Plain SVG <text> only. Two things it must NOT use:
//
//   - <foreignObject>: an SVG loaded through <img> runs in a restricted mode
//     where foreignObject content is unreliable and will not render.
//   - textLength with lengthAdjust: stretching glyphs to fill a width distorts
//     them, and a row of distorted type reads as a broken page rather than as a
//     placeholder.
//
// So the width of a line is ESTIMATED from a per-character advance table for the
// serif in the civic display stack, and the font size is chosen so the wrapped
// block fits. The table below is Palatino/Georgia-class serif advance widths in
// em units. It is an estimate, and it is deliberately biased slightly WIDE: an
// over-estimate shrinks the type a little, while an under-estimate pushes text
// out of the box, and only one of those is a bug a reader sees.
//
// The banner name is wrapped to at most 3 lines by a greedy wrapper, and the
// thumbnail sets the day and month only - at 4.5rem of width there is no room for
// a name, and illegible 5px text is worse than none.
//
// ASCII ONLY. Every character this file emits, including inside SVG text
// content, is below 128. An em dash in a data file would be emitted into an image
// whose whole purpose is to be unmistakable, and would fail the ASCII test.
//
// ---------------------------------------------------------------------------
// USAGE
// ---------------------------------------------------------------------------
//
//   node scripts/make-placeholders.mjs [--force] [--help]
//
// EXIT CODES
//   0  every event ended up with at least one image, or with a stated reason
//   1  an event ended up with neither image nor a reason, or the data is unreadable
//   2  bad arguments

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatEventDate, formatEventDateSpan, parseWallClock } from '../src/lib/events-schema.ts';
import { MONTHS, twoDigits } from '../src/lib/months.ts';
// Shared with scripts/check-events.mjs: both read the same hand-edited
// data/events.json, so both strip a leading BOM, and there is one implementation.
import { stripBom } from './lib/bom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const DEFAULT_DATA_PATH = resolve(PROJECT_ROOT, 'data', 'events.json');
const PUBLIC_DIR = resolve(PROJECT_ROOT, 'public');

const RULES = '='.repeat(72);

// ---------------------------------------------------------------------------
// The palette, from src/styles/themes.css, civic, LIGHT rendering.
// ---------------------------------------------------------------------------
//
// civic is declared once on :root through light-dark(), so "civic" is a choice of
// SCHEME rather than a second set of tokens. These are the first arguments: the
// light values. The warm paper ground is --bg and the frame is --rule.
const PALETTE = {
  paper: '#faf6ef', // --bg        (civic, light)
  rule: '#ded3c2', // --rule      (civic, light)
  ink: '#201c17', // --text      (civic, light)
  muted: '#57504a', // --text-muted (civic, light)
  accent: '#7d2a12' // --accent    (civic, light)
};

/**
 * The display serif, as an SVG font-family list.
 *
 * The same stack as --font-display in themes.css, with the quoted names
 * de-quoted: SVG font-family takes a CSS font list, and unquoted multi-word
 * family names are legal CSS. A web font would be the wrong call for the same
 * reason it is wrong on the page: a document that blocks on a font download is a
 * document that does not render.
 */
const SERIF = "Iowan Old Style, Palatino Linotype, Palatino, Charter, Georgia, Cambria, Times New Roman, serif";

/** The fixed pixel sizes the components declare. These are not preferences. */
export const BANNER = Object.freeze({ width: 1600, height: 600 });
export const THUMB = Object.freeze({ width: 480, height: 320 });

// ---------------------------------------------------------------------------
// Advance widths, in em units of the font size.
// ---------------------------------------------------------------------------

/**
 * Per-character advance width in em units, for the SERIF stack above.
 *
 * MEASURED, NOT GUESSED. Every glyph was measured in headless Chrome at 1000px
 * with getComputedTextLength(), once per family in the stack, and the value kept
 * is the WIDEST of those families, rounded up.
 *
 * Widest-across-the-stack is the whole point, and it is why this is not the
 * widths of the face this machine happens to prefer. The READER's machine picks
 * the font from the stack, not this script, so budgeting for the narrowest
 * candidate guarantees overflow on somebody's machine. Measured here: Georgia is
 * the widest for the lowercase, Palatino Linotype for the caps, and Iowan Old
 * Style - first in the stack, and therefore what a reader gets when it is
 * installed - is among the NARROWEST. Budgeting for Iowan produced a headline
 * 33% wider than the column it was supposed to sit in, and a date line 12% too
 * wide. Neither error is visible by reading a table of plausible-looking
 * numbers, which is why the numbers here came out of a browser.
 */
const ADVANCE = {
  ' ': 0.25,
  A: 0.78,
  B: 0.67,
  C: 0.71,
  D: 0.77,
  E: 0.65,
  F: 0.6,
  G: 0.76,
  H: 0.83,
  I: 0.39,
  J: 0.52,
  K: 0.73,
  L: 0.61,
  M: 0.95,
  N: 0.83,
  O: 0.79,
  P: 0.61,
  Q: 0.79,
  R: 0.7,
  S: 0.56,
  T: 0.62,
  U: 0.78,
  V: 0.72,
  W: 1.0,
  X: 0.72,
  Y: 0.72,
  Z: 0.67,
  a: 0.5,
  b: 0.56,
  c: 0.45,
  d: 0.61,
  e: 0.49,
  f: 0.33,
  g: 0.56,
  h: 0.58,
  i: 0.29,
  j: 0.29,
  k: 0.56,
  l: 0.29,
  m: 0.88,
  n: 0.59,
  o: 0.55,
  p: 0.6,
  q: 0.56,
  r: 0.41,
  s: 0.43,
  t: 0.35,
  u: 0.6,
  v: 0.56,
  w: 0.83,
  x: 0.52,
  y: 0.56,
  z: 0.5,
  0: 0.61,
  1: 0.55,
  2: 0.56,
  3: 0.55,
  4: 0.56,
  5: 0.55,
  6: 0.57,
  7: 0.55,
  8: 0.6,
  9: 0.57,
  '-': 0.37,
  '.': 0.27,
  ',': 0.27,
  "'": 0.24,
  '(': 0.38,
  ')': 0.38,
  '/': 0.49,
  ':': 0.31
};

/**
 * The width budgeted for a character this table does not know.
 *
 * 0.62em: the widest MEASURED lowercase in the stack ('d' and 'p'), plus a little.
 * A character outside the table is one a reader on some other machine can still
 * have - an accented letter, say - and the safe direction to be wrong in is wide.
 */
const DEFAULT_ADVANCE = 0.62;

/**
 * Vertical metrics in em, measured in Chrome by the same method as the advances.
 *
 * CAP_EM is the baseline-to-cap-top distance, and it is emphatically NOT the 0.70
 * that a serif is traditionally said to have: the widest family in the stack puts
 * its cap top at 1.05em, because Palatino Linotype is a large-on-the-body face.
 * Budgeting 0.70 is how a block of type ends up with its descenders lying on top
 * of the date line beneath it. Measured in a browser, not guessed at.
 *
 * DESC_EM is the depth of a descender below the baseline: worst measured case
 * 0.299em, rounded up.
 */
const CAP_EM = 1.05;
const DESC_EM = 0.3;

/**
 * Line-to-line distance as a multiple of the font size.
 *
 * 1.14 is --leading-tight (1.15) from themes.css, less a hundredth so the
 * arithmetic lands on two decimals. Tight leading is right here: the block is a
 * plate, not a paragraph, and it should read as one object.
 */
const LINE_GAP_EM = 1.14;

/**
 * The estimated width of a run of text, in em units.
 *
 * Letter spacing is added AFTER EVERY CHARACTER in CSS, including the last one,
 * so a letterspaced line is (glyph advances + one tracking per character) and NOT
 * (advances + one tracking per gap). Conflating the two under-counts a
 * letterspaced line by a whole character width, which is how a date line ends a
 * few pixels outside its frame while every glyph looks correctly placed.
 *
 * trackingEm is in em. To budget a fixed PIXEL tracking - which is what the SVG
 * sets - pass trackingPx / fontSize, or use estimatedWidthPx, which does it.
 */
export function estimatedWidthEm(text, trackingEm = 0) {
  let total = 0;
  for (const character of String(text)) {
    const advance = Object.prototype.hasOwnProperty.call(ADVANCE, character) ? ADVANCE[character] : DEFAULT_ADVANCE;
    total += advance + trackingEm;
  }
  return total;
}

/** The estimated width of a run of text in pixels, with tracking in pixels. */
export function estimatedWidthPx(text, fontSize, trackingPx = 0) {
  return estimatedWidthEm(text, fontSize === 0 ? 0 : trackingPx / fontSize) * fontSize;
}

/**
 * Greedy word wrap to a pixel width.
 *
 * Greedy because a greedy break is the one a reader expects: it is what a text
 * column does. Balanced wrapping would give prettier rag, and would also make
 * every line depend on the shape of the whole paragraph rather than on the words
 * in front of it - a bad trade in a file that lives in a diff.
 *
 * A single word longer than the box is left whole on its own line rather than
 * broken. Hyphenating a NAME would put a hyphen into the artwork that is not in
 * the data, so the caller's size search shrinks instead.
 */
export function wrapGreedy(text, fontSize, maxWidthPx, trackingPx = 0) {
  const words = String(text).split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];

  const lines = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (estimatedWidthPx(candidate, fontSize, trackingPx) <= maxWidthPx) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/** The largest size in [min, max] at which every wrapped line fits maxWidthPx. */
function sizeThatFitsWidth(text, maxWidthPx, max, min, trackingPx = 0) {
  for (let size = max; size >= min; size -= 1) {
    const lines = wrapGreedy(text, size, maxWidthPx, trackingPx);
    const widest = lines.reduce((worst, line) => Math.max(worst, estimatedWidthPx(line, size, trackingPx)), 0);
    if (widest <= maxWidthPx) return size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// XML text handling
// ---------------------------------------------------------------------------

/**
 * Escape the five XML metacharacters.
 *
 * Event names are free text, and "&" and "<" are both ordinary in English event
 * titles ("Meet & Greet", "Candidates <Unopposed>"). Emitting a name raw would
 * produce a document that no parser accepts, and an image that no browser shows.
 */
export function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** One number, formatted the same way every time. */
function num(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The banner's date line, uppercase, in the site's own date shape.
 *
 * `3 NOVEMBER 2026`, and `15 - 31 OCTOBER 2026` for the multi-day event, which
 * is the span form: repeating the month on both ends of a range that sits inside
 * one month is noise, and `15 October - 31 October` is wider than it needs to be
 * on a plate that is already carrying a wrapped name.
 *
 * A timed event also carries its clock time, because an image that says only
 * "6 OCTOBER 2026" next to a row that says 7:00 pm is a smaller lie than the
 * omission would be. formatEventTime is NOT used here because it emits a
 * lowercase meridiem, and this line is set in letterspaced capitals. The clock
 * half is built from parseWallClock, the same parser the site uses, so the two
 * cannot disagree about what hour it is; the DATE half is not built here at all,
 * it is formatEventDateSpan's output verbatim.
 */
export function bannerDateLine(event) {
  const start = parseWallClock(event.startsAt);
  if (start === null) return '';

  // DELEGATED TO formatEventDateSpan, WHICH IS THE SITE'S OWN FORMATTER.
  //
  // This used to reimplement the span by hand: it tested for a month or year
  // boundary and then printed `start.day - end.day MONTHS[start.month] start.year`
  // anyway, so a span crossing into another month rendered as `28 - 4 OCTOBER
  // 2026` - a window that ends before it starts. The comment above this function
  // claimed the shape "cannot disagree with the row". It could, and it did, and
  // the reason no test caught it is that the one span in the data sat inside a
  // single month.
  //
  // One call to the real formatter removes both the bug and the possibility of
  // the two drifting again.
  const datePart = formatEventDateSpan(event.startsAt, event.endsAt);

  let line = datePart.toUpperCase();
  if (!start.allDay) {
    const meridiem = start.hour < 12 ? 'AM' : 'PM';
    const hour12 = start.hour % 12 === 0 ? 12 : start.hour % 12;
    line += `, ${hour12}:${twoDigits(start.minute)} ${meridiem}`;
  }
  return line;
}

/**
 * The thumbnail's text: day and month, in that order, in capitals.
 *
 * `3 NOV`. NOT `NOV 3`: the order is a choice, and it is made once here and used
 * everywhere - a thumbnail reading `3 NOV` beside a banner reading
 * `3 NOVEMBER 2026` is consistent, and the reverse would be two spellings of one
 * date on the same card.
 *
 * Three-letter month abbreviations are derived from the shared MONTHS table by
 * truncation, never from Intl.DateTimeFormat: ICU would give `Sep` in one locale
 * and `Sept` in another, and the built bytes would then depend on the build
 * machine.
 */
export function thumbDateLine(event) {
  const start = parseWallClock(event.startsAt);
  if (start === null) return '';
  return `${start.day} ${MONTHS[start.month - 1].slice(0, 3).toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// The two renderers. PURE: same event in, same string out.
// ---------------------------------------------------------------------------

/**
 * The banner: 1600 x 600. Warm paper, a thin inset rule frame, then the name,
 * the date line and PLACEHOLDER.
 *
 * Returns the SVG together with the facts a caller needs to check it: how many
 * lines the name wrapped to, and whether anything failed to fit. The overflow
 * flag is reported rather than silently corrected, because an image whose text
 * runs past its frame is a defect someone has to hear about.
 */
export function renderBanner(event) {
  const W = BANNER.width;
  const H = BANNER.height;
  const frameInset = 48;
  // The text column sits inside the frame, not on it.
  const left = 112;
  const boxWidth = W - left * 2;

  const name = String(event.name ?? '').trim();
  const dateLine = bannerDateLine(event);

  // ---- the date line first, because the name block is fitted AGAINST it ----
  //
  // Order matters and the reason is the bug this layout was written to fix: a
  // name block and a date line that are each fitted to the FRAME can still
  // overlap each other. A descender on the last name line reaches well below its
  // baseline, and the date line's cap tops reach well above its own. So the date
  // line is placed first, its cap top is computed, and the name block is only
  // allowed to come as high as that cap top.
  const dateTrackingPx = 4; // --tracking-caps in themes.css, at a 42px size
  let dateSize = 42;
  if (estimatedWidthPx(dateLine, dateSize, dateTrackingPx) > boxWidth) {
    const fitted = sizeThatFitsWidth(dateLine, boxWidth, 42, 14, dateTrackingPx);
    dateSize = fitted === null ? 14 : fitted;
  }
  const dateOverflow = estimatedWidthPx(dateLine, dateSize, dateTrackingPx) > boxWidth;

  const dateBaseline = 452;
  const dateCapTop = dateBaseline - CAP_EM * dateSize;
  // A little air between the name block's lowest descender and the date line's
  // highest cap. Without it the two are technically not touching and still look
  // like they are.
  const nameToDateGap = 14;

  // ---- the name block ----
  //
  // The block is fitted into a BAND - the space between the top of the content
  // area and the date line's cap top - and then CENTRED in it. Bottom-anchoring
  // the last line instead is simpler and leaves a one-line name sitting under an
  // empty half-plate, which reads as a mistake even though nothing overflows.
  const contentTop = 120;
  const bandBottom = dateCapTop - nameToDateGap;
  const maxNameLines = 3;
  const maxNameSize = 92;

  /** Block ink height: first cap top down to the last descender. */
  const blockInkHeight = (count, size) => (count - 1) * LINE_GAP_EM * size + (CAP_EM + DESC_EM) * size;

  /** The first baseline of a block of `count` lines at `size`, centred in the band. */
  const centredFirstBaseline = (count, size) => {
    const slack = bandBottom - contentTop - blockInkHeight(count, size);
    return contentTop + Math.max(0, slack) / 2 + CAP_EM * size;
  };

  let nameSize = null;
  let nameLines = [];
  for (let size = maxNameSize; size >= 20; size -= 1) {
    const lines = wrapGreedy(name, size, boxWidth);
    if (lines.length > maxNameLines) continue;
    const widest = lines.reduce((worst, line) => Math.max(worst, estimatedWidthPx(line, size)), 0);
    if (widest > boxWidth) continue;
    if (blockInkHeight(lines.length, size) > bandBottom - contentTop) continue;

    nameSize = size;
    nameLines = lines;
    break;
  }
  if (nameSize === null) {
    // Nothing fit. Emit at the floor and let `overflow` say so, rather than
    // silently dropping the name - an unnamed banner is worse than a tight one.
    nameSize = 20;
    nameLines = wrapGreedy(name, nameSize, boxWidth);
  }

  const nameGap = LINE_GAP_EM * nameSize;
  const nameFirstBaseline = centredFirstBaseline(nameLines.length, nameSize);
  const nameWidest = nameLines.reduce((worst, line) => Math.max(worst, estimatedWidthPx(line, nameSize)), 0);
  const nameOverflow =
    nameLines.length > maxNameLines ||
    nameWidest > boxWidth ||
    blockInkHeight(nameLines.length, nameSize) > bandBottom - contentTop;

  // ---- the marker ----
  const tagText = 'PLACEHOLDER';
  const tagTrackingPx = 4;
  const tagSize = 26;
  const tagOverflow = estimatedWidthPx(tagText, tagSize, tagTrackingPx) > boxWidth;

  const title = `Placeholder artwork for ${name || 'an event'}: a typographic plate, not a photograph`;
  const description =
    `A warm paper plate carrying the event name "${name}" and the date ${dateLine || '(no usable date)'}. ` +
    'It stands in for artwork that does not exist yet and must be replaced with a real photograph.';

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  lines.push(`  <title>${escapeXml(title)}</title>`);
  lines.push(`  <desc>${escapeXml(description)}</desc>`);
  lines.push(`  <rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>`);
  lines.push(
    `  <rect x="${frameInset}" y="${frameInset}" width="${W - frameInset * 2}" height="${H - frameInset * 2}" ` +
      `fill="none" stroke="${PALETTE.rule}" stroke-width="2"/>`
  );
  lines.push(
    `  <text x="${left}" y="${num(nameFirstBaseline)}" font-family="${SERIF}" font-size="${nameSize}" ` +
      `fill="${PALETTE.ink}" xml:space="preserve">`
  );
  // Each line is its own tspan with an ABSOLUTE y, rather than one text element
  // and dy chaining. Not cosmetic: y on a <text> is the first baseline only, and
  // a dy chain makes every subsequent position depend on how the renderer
  // accumulates it. One checked number per line.
  nameLines.forEach((line, index) => {
    lines.push(`    <tspan x="${left}" y="${num(nameFirstBaseline + index * nameGap)}">${escapeXml(line)}</tspan>`);
  });
  lines.push('  </text>');
  lines.push(
    `  <text x="${left}" y="${dateBaseline}" font-family="${SERIF}" font-size="${dateSize}" ` +
      `letter-spacing="${dateTrackingPx}" fill="${PALETTE.muted}">${escapeXml(dateLine)}</text>`
  );
  lines.push(
    `  <text x="${left}" y="516" font-family="${SERIF}" font-size="${tagSize}" letter-spacing="${tagTrackingPx}" ` +
      `fill="${PALETTE.accent}">${tagText}</text>`
  );
  lines.push('</svg>');

  return {
    kind: 'banner',
    width: W,
    height: H,
    svg: `${lines.join('\n')}\n`,
    nameLines,
    nameSize,
    dateLine,
    overflow: nameOverflow || dateOverflow || tagOverflow
  };
}

/**
 * The thumbnail: 480 x 320. The day and the month, and nothing else.
 *
 * The components render this at 4.5rem of width. There is no room for a name at
 * that size, and text too small to read is worse than no text, so the name is not
 * attempted at any size.
 */
export function renderThumb(event) {
  const W = THUMB.width;
  const H = THUMB.height;
  const frameInset = 20;
  const left = 64;
  const boxWidth = W - left - 64;
  const contentTop = 96;

  const line = thumbDateLine(event);

  let size = null;
  for (let candidate = 120; candidate >= 40; candidate -= 1) {
    const baseline = contentTop + CAP_EM * candidate;
    if (estimatedWidthPx(line, candidate) <= boxWidth && baseline <= H - 64) {
      size = candidate;
      break;
    }
  }
  if (size === null) size = 40;

  const baseline = contentTop + CAP_EM * size;
  const overflow = estimatedWidthPx(line, size) > boxWidth || baseline > H - 64;

  const title = `Placeholder artwork for ${String(event.name ?? '').trim() || 'an event'}: the date ${line || '(no usable date)'}`;

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`);
  lines.push(`  <title>${escapeXml(title)}</title>`);
  lines.push(`  <rect width="${W}" height="${H}" fill="${PALETTE.paper}"/>`);
  lines.push(
    `  <rect x="${frameInset}" y="${frameInset}" width="${W - frameInset * 2}" height="${H - frameInset * 2}" ` +
      `fill="none" stroke="${PALETTE.rule}" stroke-width="2"/>`
  );
  lines.push(
    `  <text x="${left}" y="${num(baseline)}" font-family="${SERIF}" font-size="${size}" fill="${PALETTE.ink}">` +
      `${escapeXml(line)}</text>`
  );
  lines.push('</svg>');

  return {
    kind: 'thumbnail',
    width: W,
    height: H,
    svg: `${lines.join('\n')}\n`,
    dateLine: line,
    size,
    overflow
  };
}

// ---------------------------------------------------------------------------
// Path decisions. EXTRACTED so a test can prove them without a disk.
// ---------------------------------------------------------------------------

/**
 * Should this declared path be written at all?
 *
 * Three answers, and the third is the interesting one:
 *
 *   null-path    the field is null. A MEANINGFUL absence - the schema models it
 *                and the components render around it. Nothing is created.
 *   not-svg      the path names something that is not an SVG. That is a REAL
 *                PHOTOGRAPH - a .jpg here is a picture somebody took, and
 *                overwriting it with a typographic plate would destroy work.
 *   render       an SVG that this script may draw.
 *
 * Note that `null-path` and `not-svg` are distinguished, because "there is
 * nothing there" and "there is something precious there" are different facts and
 * the report must say which it found.
 */
export function decideTarget(field, value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return { action: 'skip', reason: 'null-path' };
  }
  const declared = String(value);
  if (!/\.svg$/i.test(declared)) {
    return { action: 'skip', reason: 'not-svg' };
  }
  return { action: 'render', reason: null };
}

/**
 * Resolve a declared path against public/, refusing anything that leaves it.
 *
 * The schema already rejects a ".."-shaped segment, but this file does not gate
 * on the schema, so it checks for itself: a path that resolves OUTSIDE public/
 * would let a hand-edited data file write anywhere on the disk, and the script
 * that is supposed to be harmless would then be the one with the sharp edge.
 */
export function resolveInside(publicDir, declared) {
  const relativePart = String(declared).replace(/^\/+/, '');
  const full = resolve(joinSafe(publicDir, relativePart));
  const rel = relative(publicDir, full);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return full;
}

/** Join without importing path.join's edge cases into the escaping check. */
function joinSafe(base, part) {
  if (sep === '\\') return `${base.replace(/[\\/]+$/, '')}\\${part.replace(/\//g, '\\')}`;
  return `${base.replace(/\/+$/, '')}/${part}`;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

async function fileExists(full) {
  try {
    const info = await stat(full);
    return info.isFile();
  } catch {
    return false;
  }
}

/**
 * Write one image, unless the file is already there.
 *
 * THE ONE RULE THAT PROTECTS REAL ARTWORK. Everything else in this script is
 * about how the placeholder looks; this is about what happens when someone
 * replaces it with a photograph and then re-runs the generator by muscle memory.
 */
export async function writeImage(full, svg, { force = false } = {}) {
  const exists = await fileExists(full);
  if (exists && !force) {
    return { action: 'skipped', reason: 'already-exists', bytes: 0 };
  }
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, svg, 'utf8');
  return { action: exists ? 'forced' : 'wrote', reason: null, bytes: Buffer.byteLength(svg, 'utf8') };
}

// ---------------------------------------------------------------------------
// Reading the data
// ---------------------------------------------------------------------------

/**
 * Pull the event list out of the parsed document.
 *
 * Only the events array is required. A whole-file schema pass is deliberately
 * NOT run here - see the header - so a dataset being edited right now still
 * yields its artwork, with any unusable field reported per event.
 */
export function extractEvents(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return null;
  if (!Array.isArray(doc.events)) return null;
  return doc.events;
}

/**
 * The fields this script needs, checked. Returns null when usable, or a reason.
 *
 * `startsAt` is checked with the site's own parseWallClock rather than a regex,
 * so a value this script accepts is a value the page also accepts, and the date
 * on the plate is the date on the row.
 */
function eventProblem(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return 'not-an-object';
  if (typeof event.name !== 'string' || event.name.trim() === '') return 'no-name';
  if (parseWallClock(event.startsAt) === null) return 'unusable-starts-at';
  if (event.endsAt && parseWallClock(event.endsAt) === null) return 'unusable-ends-at';
  return null;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

// Indexed rather than `for...of`, because `--data <path>` has to CONSUME the
// next argument and a for...of cannot skip one.
//
// The bug this replaces rejected the space-separated form outright, even when a
// path followed it, while this file's own HELP text advertised exactly that
// form (`-d, --data <path>`). The sibling script scripts/check-events.mjs parsed
// the same flag correctly, so two CLIs in one project disagreed about one flag
// and the one that disagreed was the one documented as working.
export function parseArgs(argv) {
  const opts = { force: false, data: DEFAULT_DATA_PATH, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      opts.help = true;
      continue;
    }
    if (arg === '--force' || arg === '-f') {
      opts.force = true;
      continue;
    }
    if (arg === '--data' || arg === '-d') {
      const value = argv[i + 1];
      // Error ONLY when there is genuinely nothing after the flag. A path that
      // happens to begin with "--" is still a path, so do not test for that.
      if (value === undefined) throw new Error('--data needs a path');
      opts.data = resolve(value);
      i += 1;
      continue;
    }
    if (arg.startsWith('--data=')) {
      opts.data = resolve(arg.slice('--data='.length));
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `make-placeholders - generate typographic placeholder artwork for every event

USAGE
  node scripts/make-placeholders.mjs [--force] [--data <path>]

OPTIONS
      --force       overwrite files that already exist.
                   --force WILL DESTROY REAL ARTWORK. An existing file is a
                   photograph somebody took until proven otherwise.
  -d, --data <path>  the dataset to read. Default: data/events.json
  -h, --help         print this and exit 0

EXIT CODES
  0  every event ended up with at least one image, or with a stated reason
  1  an event ended up with neither image nor a reason
  2  bad arguments, or the data is missing / unreadable / not JSON

NOTES
  Only .svg paths are written. A .jpg in the data is a real photograph and is
  left alone. This script never reads the page's CSS: an SVG loaded through
  <img> is an isolated document, so the civic palette below is hardcoded. See
  the header in this file for why that is correct rather than a defect.`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Do the work, and RETURN it rather than printing it.
 *
 * The report is built as data and printed by main(). That is what lets
 * test/placeholders.test.mjs assert on what the run decided - the refusal to
 * overwrite, the .jpg skip, the null skip - without scraping stdout.
 */
export async function generate(events, { publicDir = PUBLIC_DIR, force = false } = {}) {
  const rows = [];
  const problems = [];

  for (const event of events) {
    const reason = eventProblem(event);
    if (reason !== null) {
      problems.push({ id: typeof event?.id === 'string' ? event.id : '(unknown)', reason });
      continue;
    }

    let produced = 0;
    let explained = 0;

    for (const field of ['thumbnail', 'banner']) {
      const declared = event[field] ?? null;
      const decision = decideTarget(field, declared);
      if (decision.action === 'skip') {
        rows.push({ id: event.id, field, path: declared, ...decision });
        explained += 1;
        continue;
      }
      const full = resolveInside(publicDir, declared);
      if (full === null) {
        rows.push({ id: event.id, field, path: declared, action: 'skip', reason: 'outside-public' });
        explained += 1;
        continue;
      }
      const rendered = field === 'banner' ? renderBanner(event) : renderThumb(event);
      if (rendered.overflow) {
        // Said out loud, not fixed by shrinking further. A plate whose type runs
        // past its frame is a thing for a human to look at.
        problems.push({ id: event.id, reason: `text-overflow-${field}`, size: rendered.nameSize ?? rendered.size });
      }
      const written = await writeImage(full, rendered.svg, { force });
      rows.push({ id: event.id, field, path: declared, full, bytes: written.bytes, overflow: rendered.overflow, ...written });
      if (written.action === 'wrote' || written.action === 'forced') produced += 1;
      else explained += 1;
    }

    if (produced === 0 && explained === 0) {
      problems.push({ id: event.id, reason: 'no-image-and-no-reason' });
    }
  }

  return { rows, problems };
}

/** The report, as lines. Printed by main; asserted by the tests. */
export function reportLines(result, { events, publicDir, force }) {
  const onDisk = sep === '\\' ? 'public\\' : 'public/';
  const lines = [];
  lines.push(RULES);
  lines.push(`events: ${events.length}`);
  lines.push(`placeholders: ${force ? 'OVERWRITING existing .svg files (--force)' : 'refusing to overwrite'}`);
  lines.push(`target: ${publicDir}`);

  const wanted = result.rows.filter((row) => row.action === 'wrote' || row.action === 'forced');
  const skipped = result.rows.filter((row) => row.action === 'skipped' || (row.action === 'skip' && row.reason !== 'already-exists'));

  lines.push('');
  lines.push(`  [write] ${wanted.length} image(s):`);
  for (const row of wanted) {
    const verb = row.action === 'forced' ? 'forced' : 'wrote';
    lines.push(`    ${verb.padEnd(7)} ${row.path}  (${row.bytes} bytes, ${row.field})`);
  }
  if (wanted.length === 0) lines.push('    (none)');

  lines.push('');
  lines.push(`  [skip ] ${skipped.length} image(s):`);
  for (const row of skipped) {
    lines.push(`    ${row.reason.padEnd(15)} ${String(row.path)}  (${row.id}.${row.field})`);
  }
  if (skipped.length === 0) lines.push('    (none)');

  if (result.problems.length > 0) {
    lines.push('');
    lines.push(`  [WARN ] ${result.problems.length} problem(s):`);
    for (const problem of result.problems) {
      lines.push(`    ${problem.reason.padEnd(24)} ${problem.id}${problem.size ? ` (at ${problem.size}px)` : ''}`);
    }
  }

  lines.push('');
  lines.push(`  events:    ${events.length}`);
  lines.push(`  written:   ${wanted.length}`);
  lines.push(`  skipped:   ${skipped.length}`);
  lines.push(`  problems:  ${result.problems.length}`);
  lines.push(`  expect at: ${onDisk}img/events/`);
  lines.push(RULES);
  return lines;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`fatal: ${error.message}\n`);
    process.stderr.write(`\n${HELP}\n`);
    return 2;
  }

  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }

  let text;
  try {
    text = await readFile(opts.data, 'utf8');
  } catch (error) {
    process.stderr.write(`fatal: cannot read ${opts.data}: ${error.code ?? error.message}\n`);
    return 2;
  }

  let doc;
  try {
    doc = JSON.parse(stripBom(text));
  } catch (error) {
    process.stderr.write(`fatal: ${opts.data} is not valid JSON: ${error.message}\n`);
    return 2;
  }

  const events = extractEvents(doc);
  if (events === null) {
    process.stderr.write(`fatal: ${opts.data} has no "events" array\n`);
    return 2;
  }

  const result = await generate(events, { publicDir: PUBLIC_DIR, force: opts.force });
  process.stdout.write(`${reportLines(result, { events, publicDir: PUBLIC_DIR, force: opts.force }).join('\n')}\n`);

  const hard = result.problems.filter((problem) => problem.reason === 'no-image-and-no-reason' || problem.reason === 'not-an-object');
  return hard.length > 0 ? 1 : 0;
}

// Direct-invocation guard, so a test can import this module without running it.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`fatal: ${error && error.stack ? error.stack : error}\n`);
      process.exitCode = 1;
    });
}
