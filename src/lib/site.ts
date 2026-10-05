// src/lib/site.ts - site-wide identity, and the one place that knows about the
// deployment base path.
//
// ---------------------------------------------------------------------------
// PLACEHOLDER CONTENT - READ BEFORE SHIPPING
// ---------------------------------------------------------------------------
//
// SITE_NAME, SITE_TAGLINE and SITE_INTRO are PROVISIONAL. The client has not
// chosen the organisation's name, tagline, voice or domain yet (ROADMAP.md,
// "Open items needing the user"). They are written to be plainly generic rather
// than plausibly impressive, because a placeholder that reads like a finished
// name is one somebody ships by accident. Phase 5 replaces this file.
//
// ---------------------------------------------------------------------------
// THE BASE PATH IS NOT A CONSTANT
// ---------------------------------------------------------------------------
//
// astro.config.mjs reads `base` from process.env.BASE_PATH, because a GitHub
// Pages project site is served from a subpath (https://<user>.github.io/<repo>/).
// A hardcoded leading-slash href is correct on localhost and 404s in CI, so
// every internal link in this project goes through `withBase()`.
//
// This file reads import.meta.env, which only exists inside the Astro/Vite
// build. That is deliberate: it keeps this module out of the node --test run
// (see src/lib/articles.ts, which IS unit tested and imports no env).
// ---------------------------------------------------------------------------

/** The organisation's name. PROVISIONAL - see the note above. */
export const SITE_NAME = 'Speakers Bureau';

/**
 * One line of positioning, shown under the name in the masthead.
 * PROVISIONAL - see the note above.
 */
export const SITE_TAGLINE = 'A front door to independent writing.';

/**
 * The short honest paragraph on the home page. PROVISIONAL - see above.
 *
 * The honesty constraint, stated once so it is not restated badly later:
 * publication feeds return only each publication's most recent posts, so this
 * site holds no history. Every word of site copy that describes the collection
 * has to survive the question "is that true of a 20-item feed window?".
 */
export const SITE_INTRO =
  'We do not host these articles. We collect the current feeds of a small number of ' +
  'independent publications, put them in one reading order, and link straight out to ' +
  'where the writing actually lives.';

/**
 * The window disclosure. Rendered on every page that lists articles, because it
 * is the fact that most shapes what a reader should expect from this site.
 */
export const SITE_WINDOW_NOTE =
  'Each publication\'s feed returns only its most recent posts, so this is a window ' +
  'onto what is being written now, not an archive. When a post falls out of a feed it ' +
  'leaves this site too.';

/** Declaration on outbound links: what actually happens when you click one. */
export const SITE_OUTBOUND_NOTE =
  'Every article link leaves this site and opens on the publication\'s own site, in a new tab.';

/** The deployment base path, always with exactly one trailing slash. */
export const BASE = import.meta.env.BASE_URL || '/';

/**
 * Prefix an internal, root-relative path with the deployment base path.
 *
 *   withBase('/topic/news/')  ->  '/topic/news/'      (local, base '/')
 *   withBase('/topic/news/')  ->  '/repo/topic/news/' (Pages, base '/repo/')
 *
 * `path` is expected to start with '/'. A trailing slash on the result is
 * preserved because astro.config.mjs sets build.format 'directory'.
 */
export function withBase(path: string): string {
  const stem = BASE.replace(/\/+$/, '');
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${stem}${tail}`;
}

/** Human-readable publication of this site, for <title> suffixes. */
export const SITE_TITLE_SUFFIX = SITE_NAME;