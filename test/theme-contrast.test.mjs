// test/theme-contrast.test.mjs - MEASURED accessibility for the theme system.
//
// This suite exists because "we meet WCAG AA" is a claim, and a claim about
// colour is exactly the kind of thing that looks true in review and is false on
// screen. Nothing here trusts the palette's author. Every ratio is computed from
// the hex values in src/styles/themes.css using the WCAG 2.1 relative
// luminance formula, and the suite fails if any text pair falls below AA.
//
// WHAT IS MEASURED, AND WHY THESE PAIRS
//
//   4.5:1  body text on the page and on every surface behind it
//   4.5:1  muted text (captions, dates, hints) - the pair most often missed
//   4.5:1  link text, and link text in its hover state
//   4.5:1  text on a coloured fill: chip text on chip background, and label
//          text on the accent fill. These are the "text on a coloured
//          background" pairs in the brief, and a chip is the easiest thing in a
//          design system to ship unreadable.
//   3.0:1   large display text (>= 24px, or >= 18.66px bold) and non-text UI:
//          the focus ring, and rules that carry meaning. WCAG's own split.
//
// SCHEME RESOLUTION IS PART OF THE TEST, not an assumption. A theme declares
// its scheme with `color-scheme`; `light-dark()` then resolves to the matching
// branch of each token. So:
//   - `system` (and a bare <html>) is `light dark` and is checked in BOTH
//     renderings, because the reader's OS decides and we do not know which.
//   - `civic`, `ledger` are `light`, so only the light branch renders and only
//     the light branch can be checked - which is itself the proof that an
//     explicit choice beats the OS.
//   - `slate` is `dark`.
// A theme whose scheme and whose token branches disagree cannot be checked, so
// the suite also fails if a forced scheme leaves an unresolvable value.
//
// Design rule 7 is not at risk here: this reads a source stylesheet, and writes
// nothing at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..');
const THEMES_CSS = resolve(PROJECT_ROOT, 'src', 'styles', 'themes.css');
const SRC_DIR = resolve(PROJECT_ROOT, 'src');

// WCAG 2.1 thresholds.
const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3.0;
const AA_NON_TEXT = 3.0;

// Themes the site ships, and the single scheme each one renders in when it is
// chosen explicitly. `system` is not a palette; it is the civic palette with the
// OS in charge, and is checked in both renderings below.
const THEMES = {
  civic: 'light',
  ledger: 'light',
  slate: 'dark'
};

const REQUIRED_TOKENS = [
  'bg', 'surface', 'text', 'text-muted', 'link', 'link-hover', 'accent',
  'accent-contrast', 'rule', 'rule-strong', 'focus', 'chip-bg', 'chip-text'
];

// ---------------------------------------------------------------------------
// WCAG maths
// ---------------------------------------------------------------------------

/** Parse #rgb / #rrggbb into [r, g, b] 0-255. */
function parseHex(hex) {
  let value = hex.trim().toLowerCase();
  if (value.startsWith('#')) value = value.slice(1);
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-f]{6}$/.test(value)) {
    throw new Error(`not a 6-digit hex colour: "${hex}"`);
  }
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16)
  ];
}

/** WCAG relative luminance: linearize the sRGB channels, then weight them. */
function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1..21. */
function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

const round2 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// A small CSS reader, scoped to what themes.css actually contains
// ---------------------------------------------------------------------------

/** Strip /* *\/ comments so a commented-out declaration cannot be measured. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every `selector-list { declarations }` block, flattened. */
function readBlocks(css) {
  const blocks = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    const selectors = match[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '');
    const declarations = {};
    for (const piece of match[2].split(';')) {
      const colon = piece.indexOf(':');
      if (colon === -1) continue;
      const property = piece.slice(0, colon).trim();
      const value = piece.slice(colon + 1).trim();
      if (property === '' || value === '') continue;
      declarations[property] = value;
    }
    blocks.push({ selectors, declarations });
  }
  return blocks;
}

/**
 * Resolve one theme's tokens in one scheme.
 *
 * Cascade, in the order the browser would apply it for these selectors:
 *   1. the `:root` default block
 *   2. `html[data-theme="<theme>"]`
 * `light-dark(a, b)` is then resolved to `a` for the light scheme and `b` for
 * the dark one. The theme's own block supplies `color-scheme`, and that is what
 * selects the branch - which is the whole mechanism the stylesheet relies on,
 * so the test resolves it the same way rather than asserting it separately.
 */
function resolveTheme(blocks, theme, scheme) {
  const branches = {};
  const plain = {};
  let themeScheme = null;

  const apply = (declarations, isDefault) => {
    for (const [property, value] of Object.entries(declarations)) {
      if (property === 'color-scheme') {
        themeScheme = value.trim();
        continue;
      }
      if (!property.startsWith('--')) continue;
      const lightDark = value.match(/^light-dark\(\s*(.+?)\s*,\s*(.+?)\s*\)$/);
      if (lightDark) {
        branches[property] = { light: lightDark[1], dark: lightDark[2] };
        continue;
      }
      // A single-scheme theme declares plain values. If the same token was
      // earlier expressed with light-dark(), the plain value replaces BOTH
      // branches, which is what the cascade does.
      plain[property] = value;
      delete branches[property];
    }
  };

  for (const block of blocks) {
    if (block.selectors.includes(':root')) apply(block.declarations, true);
  }

  if (theme !== null) {
    const key = `html[data-theme='${theme}']`;
    for (const block of blocks) {
      if (block.selectors.includes(key)) apply(block.declarations, false);
    }
  }

  // Final pass: the theme's own `color-scheme` picked the branch.
  const resolved = {};
  for (const [name, value] of Object.entries(branches)) {
    resolved[name] = scheme === 'dark' ? value.dark : value.light;
  }
  Object.assign(resolved, plain);

  return { tokens: resolved, scheme: themeScheme };
}

// ---------------------------------------------------------------------------

const css = stripComments(await readFile(THEMES_CSS, 'utf8'));
const blocks = readBlocks(css);

// ---------------------------------------------------------------------------
// Positive control: the parser must actually see the themes
// ---------------------------------------------------------------------------

test('the themes stylesheet defines at least three themes, and this parser sees them', async (t) => {
  // Everything below measures colours found in this file. If the parser stopped
  // matching the file's real shape, every ratio would be computed from an empty
  // palette and every assertion would pass for the wrong reason.
  const found = Object.keys(THEMES).filter((theme) =>
    blocks.some((b) => b.selectors.includes(`html[data-theme='${theme}']`))
  );

  t.diagnostic(`themes found: ${found.join(', ')}`);
  assert.ok(
    found.length >= 3,
    `expected civic, ledger and slate to be declared in themes.css, found: ${found.join(', ')}`
  );
  assert.ok(blocks.some((b) => b.selectors.includes(':root')), 'the :root default block must exist');

  const { tokens } = resolveTheme(blocks, 'civic', 'light');
  const hexCount = Object.values(tokens).filter((v) => /^#[0-9a-f]{3,6}$/i.test(v)).length;
  t.diagnostic(`civic(light) resolved tokens: ${Object.keys(tokens).length}, hex values: ${hexCount}`);
  assert.ok(
    hexCount >= 13,
    `expected the civic palette to resolve to at least 13 hex values, got ${hexCount}`
  );
});

test('the browser support floor named in themes.css is the one this design relies on', () => {
  // `light-dark()` is the dark-mode mechanism, so if it were ever removed the
  // whole scheme would silently become light-only. Assert its presence.
  assert.match(css, /light-dark\(/, 'themes.css must use light-dark() for its dark rendering');
  assert.match(css, /color-scheme:\s*light dark/, 'the default must follow the OS');
  // And the classic bug: a media query would override an explicit choice.
  const mediaDark = css.match(/@media[^{]*prefers-color-scheme:\s*dark/);
  assert.equal(
    mediaDark,
    null,
    'a prefers-color-scheme block in themes.css would override an explicit theme choice; the schema must use color-scheme instead'
  );
});

test('an explicit theme pins its own scheme, which is what beats the OS', () => {
  for (const [theme, expected] of Object.entries(THEMES)) {
    const { scheme } = resolveTheme(blocks, theme, expected);
    assert.equal(scheme, expected, `${theme} must declare color-scheme: ${expected} so the OS cannot override it`);
  }
});

test('every theme defines the same token key set', async (t) => {
  // A missing token silently INHERITS the previous theme's value, which is how a
  // fourth theme ends up half civic and nobody notices until a screenshot.
  const keySets = {};
  for (const [theme, scheme] of Object.entries(THEMES)) {
    keySets[theme] = Object.keys(resolveTheme(blocks, theme, scheme).tokens)
      .filter((key) => REQUIRED_TOKENS.includes(key.replace(/^--/, '')))
      .sort();
  }

  const reference = keySets.civic.join(',');
  for (const [theme, keys] of Object.entries(keySets)) {
    t.diagnostic(`${theme}: ${keys.length} colour tokens`);
    assert.equal(keys.join(','), reference, `${theme} does not define the full token set`);
  }
  for (const token of REQUIRED_TOKENS) {
    assert.ok(
      keySets.civic.includes(`--${token}`),
      `required token --${token} is missing from civic`
    );
  }
});

// ---------------------------------------------------------------------------
// THE MEASUREMENT
// ---------------------------------------------------------------------------

/** [foreground token, background token, minimum ratio, what it is] */
const PAIRS = [
  ['text', 'bg', AA_TEXT, 'body text on the page'],
  ['text', 'surface', AA_TEXT, 'body text on a card'],
  ['text-muted', 'bg', AA_TEXT, 'muted text on the page'],
  ['text-muted', 'surface', AA_TEXT, 'muted text on a card'],
  ['link', 'bg', AA_TEXT, 'link text on the page'],
  ['link', 'surface', AA_TEXT, 'link text on a card'],
  ['link-hover', 'bg', AA_TEXT, 'link text, hover, on the page'],
  ['chip-text', 'chip-bg', AA_TEXT, 'chip text on the chip fill'],
  ['chip-text', 'surface', AA_TEXT, 'chip text on a card'],
  ['accent-contrast', 'accent', AA_TEXT, 'text on the accent fill'],
  ['accent', 'bg', AA_TEXT, 'accent text on the page'],
  ['text', 'bg', AA_LARGE_TEXT, 'display text on the page (large-text minimum)'],
  ['focus', 'bg', AA_NON_TEXT, 'focus ring against the page'],
  ['focus', 'surface', AA_NON_TEXT, 'focus ring against a card']
];

// DECORATIVE RULES, MEASURED BUT NOT HELD TO WCAG.
//
// Stated plainly because it looks like a weakened assertion: WCAG 1.4.11
// (non-text contrast) applies to visual information REQUIRED to identify a
// user interface component or its state, and to parts of a graphic required to
// understand the content. Every rule in this project is a separator or a panel
// edge. None of them is the only signal for anything: the content they separate
// is text, and that text is measured above.
//
// The floor asserted here is NOT a WCAG number. It is 1.2:1, which means "a rule
// is visibly a rule and never disappears into the page". Enforcing 3:1 on these
// would have forced the near-black hairlines that the civic direction is
// specifically trying not to have, in exchange for meeting a rule that does not
// apply. The measured values are printed in the report below either way, so a
// future edit that quietly makes a rule invisible shows up in the log.
const DECORATIVE_FLOOR = 1.2;

const DECORATIVE_PAIRS = [
  ['rule', 'bg', 'hairline rule against the page'],
  ['rule-strong', 'bg', 'strong rule against the page'],
  ['rule-strong', 'surface', 'strong rule against a card']
];

test('MEASURED contrast: every theme, in every scheme it can render', async (t) => {
  const report = [];

  // `system` is checked in BOTH renderings, because its scheme is `light dark`
  // and the reader's operating system - not this suite - picks. Every other theme
  // renders in exactly one scheme.
  const states = [
    { label: 'system (OS light)', theme: null, scheme: 'light' },
    { label: 'system (OS dark)', theme: null, scheme: 'dark' }
  ];
  for (const [theme, scheme] of Object.entries(THEMES)) {
    states.push({ label: theme, theme, scheme });
  }

  const failures = [];

  for (const state of states) {
    const { tokens } =
      state.theme === null
        ? { tokens: resolveTheme(blocks, 'civic', state.scheme).tokens }
        : resolveTheme(blocks, state.theme, state.scheme);

    report.push(`  ${state.label}`);
    for (const [fg, bg, min, what] of PAIRS) {
      const fgValue = tokens[`--${fg}`];
      const bgValue = tokens[`--${bg}`];
      // POSITIVE CONTROL before computing: both colours must have resolved.
      // An undefined token would make the maths NaN, and every comparison
      // against NaN is false, which would look like a pass.
      assert.ok(fgValue, `${state.label}: token --${fg} did not resolve`);
      assert.ok(bgValue, `${state.label}: token --${bg} did not resolve`);
      assert.match(
        String(fgValue),
        /^#[0-9a-f]{3,6}$/i,
        `${state.label}: --${fg} is not a hex colour after resolution: ${fgValue}`
      );
      assert.match(
        String(bgValue),
        /^#[0-9a-f]{3,6}$/i,
        `${state.label}: --${bg} is not a hex colour after resolution: ${bgValue}`
      );

      // POSITIVE CONTROL on the maths: a hex pair always yields a ratio in
      // 1..21. Anything else means the formula, not the palette, is broken.
      const ratio = contrastRatio(fgValue, bgValue);
      assert.ok(
        ratio >= 1 && ratio <= 21,
        `${state.label}: contrast of ${fgValue} on ${bgValue} computed as ${ratio}, which is impossible`
      );
      report.push(`    ${ratio.toFixed(2).padStart(6)}:1  (min ${min})  ${what}  [${fg} on ${bg}]`);
      if (ratio < min) {
        failures.push(
          `${state.label}: ${what} is ${round2(ratio)}:1 (${fg} ${fgValue} on ${bg} ${bgValue}), needs ${min}:1`
        );
      }
    }

    // The same measurement against the stated non-WCAG floor. See DECORATIVE_FLOOR.
    for (const [fg, bg, what] of DECORATIVE_PAIRS) {
      const fgValue = tokens[`--${fg}`];
      const bgValue = tokens[`--${bg}`];
      assert.ok(fgValue && bgValue, `${state.label}: rule tokens --${fg}/--${bg} did not resolve`);
      const ratio = contrastRatio(fgValue, bgValue);
      report.push(`    ${ratio.toFixed(2).padStart(6)}:1  (min ${DECORATIVE_FLOOR})  ${what}  [decorative]`);
      if (ratio < DECORATIVE_FLOOR) {
        failures.push(
          `${state.label}: ${what} is ${round2(ratio)}:1, which makes it effectively invisible on the page`
        );
      }
    }
  }

  t.diagnostic(`\nMEASURED WCAG CONTRAST\n${report.join('\n')}\n`);
  assert.deepEqual(
    failures,
    [],
    `themes below WCAG AA:\n  ${failures.join('\n  ')}\n\nMeasured report:\n${report.join('\n')}`
  );
});

test('the three themes are genuinely different palettes, not three names for one', async (t) => {
  // The brief's requirement stated as a test: `civic`, `ledger` and `slate` must
  // not be the same colours under different names. Compared on the tokens that
  // define a palette's identity.
  const identity = ['bg', 'text', 'link', 'accent', 'rule', 'focus'];
  const palettes = {};
  for (const theme of Object.keys(THEMES)) {
    const { tokens } = resolveTheme(blocks, theme, THEMES[theme]);
    palettes[theme] = identity.map((name) => {
      const value = tokens[`--${name}`];
      assert.ok(value, `${theme}: identity token --${name} did not resolve`);
      return String(value).toLowerCase();
    });
  }

  const names = Object.keys(palettes);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const shared = palettes[names[i]].filter((v, idx) => v === palettes[names[j]][idx]);
      t.diagnostic(`${names[i]} vs ${names[j]}: ${shared.length} of ${identity.length} identity tokens shared`);
      assert.ok(
        shared.length <= 2,
        `${names[i]} and ${names[j]} share ${shared.length} of ${identity.length} identity tokens, ` +
          'so they are the same palette under two names'
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Guardrails: no colour literal outside themes.css
// ---------------------------------------------------------------------------

async function listSourceFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSourceFiles(full)));
    else if (/\.(astro|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test('themes.css is the ONLY file in src/ that contains a colour literal', async (t) => {
  // The whole point of the foundation. A hex in a component is a value that no
  // theme can reach, so it is a bug even when it looks right.
  const files = await listSourceFiles(SRC_DIR);
  t.diagnostic(`scanned ${files.length} file(s) under src/`);
  assert.ok(files.length >= 4, `expected to scan the src tree, found ${files.length} file(s)`);

  const HEX = /#[0-9a-fA-F]{3}\b|#[0-9a-fA-F]{6}\b/g;
  const offenders = [];
  for (const file of files) {
    const rel = file.slice(PROJECT_ROOT.length + 1).replace(/\\/g, '/');
    if (rel === 'src/styles/themes.css') continue;
    const text = stripComments(await readFile(file, 'utf8'));
    const hits = text.match(HEX);
    if (hits && hits.length > 0) offenders.push(`${rel}: ${hits.join(', ')}`);
  }
  assert.deepEqual(offenders, [], `colour literals outside themes.css:\n  ${offenders.join('\n  ')}`);
});

test('no component declares a font-size in px', async (t) => {
  // rem scales with the reader's chosen root size; px does not. A px font size
  // is a hardcoded type decision, which is what --size-* exists to prevent.
  const files = (await listSourceFiles(SRC_DIR)).filter((f) => f !== THEMES_CSS);
  const offenders = [];
  for (const file of files) {
    const rel = file.slice(PROJECT_ROOT.length + 1).replace(/\\/g, '/');
    const text = stripComments(await readFile(file, 'utf8'));
    const pattern = /font-size\s*:\s*([^;}]+)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[1].trim();
      if (value.includes('var(')) continue;
      offenders.push(`${rel}: font-size: ${value}`);
    }
  }
  t.diagnostic(`font-size declarations checked across ${files.length} file(s)`);
  assert.deepEqual(offenders, [], `non-token font sizes:\n  ${offenders.join('\n  ')}`);
});

test('the switcher offers every theme declared in themes.css', async () => {
  // A theme with no control is unreachable on a no-JS page, and a control for a
  // theme that no longer exists is a lie. Both are caught by comparing the two
  // lists.
  const switcher = await readFile(
    resolve(PROJECT_ROOT, 'src', 'components', 'ThemeSwitcher.astro'),
    'utf8'
  );
  for (const theme of Object.keys(THEMES)) {
    assert.match(
      switcher,
      new RegExp(`value: '${theme}'`),
      `the switcher has no option for the ${theme} theme`
    );
  }
  // `system` is a scheme choice, not a palette, but it is the default and must
  // still be selectable.
  assert.match(switcher, /value: 'system'/, 'the switcher must offer the system scheme option');
});

test('the Layout ships data-theme and applies a stored theme before paint', async () => {
  // The no-flash guarantee, asserted against the source rather than trusted.
  const layout = await readFile(resolve(PROJECT_ROOT, 'src', 'layouts', 'Layout.astro'), 'utf8');

  assert.match(layout, /<html lang="en" data-theme="system">/, 'the default theme attribute is missing');
  assert.match(layout, /<script is:inline/, 'the theme script must be inline or it will be deferred and flash');

  const scriptAt = layout.indexOf('is:inline');
  const bodyAt = layout.indexOf('<body');
  assert.ok(scriptAt !== -1 && bodyAt !== -1, 'expected a theme script and a body');
  assert.ok(scriptAt < bodyAt, 'the theme script must precede the body so it runs before paint');

  // The allowlist is shared with the component list, so an unknown persisted
  // value can never become a data-theme attribute.
  assert.match(layout, /THEME_VALUES/, 'the script must validate the stored value against an allowlist');
  assert.match(layout, /localStorage/, 'the script must read the stored choice');
  assert.match(layout, /data-theme-option/, 'the delegated handler must key off the radio inputs');
});