// src/lib/site.ts - site-wide identity, and the one place that knows about the
// deployment base path.
//
// ---------------------------------------------------------------------------
// PLACEHOLDER CONTENT - READ BEFORE SHIPPING
// ---------------------------------------------------------------------------
//
// SITE_NAME and SITE_CURATOR were CHOSEN by the client on 2026-10-05 and are no
// longer placeholders. SITE_TAGLINE, SITE_INTRO and SITE_WINDOW_NOTE are still
// written for this project rather than supplied by the client, and the `site`
// value in astro.config.mjs is still https://example.org.
//
// A placeholder is only useful while it is obviously one. The name and byline were
// written plainly as placeholders so nobody would ship them by accident; now that
// they are real, the remaining provisional values keep that property until the
// client replaces them too.
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

/**
 * The publication's name, chosen by the client 2026-10-05. This was the
 * placeholder "Speakers Bureau"; the apostrophe in "Citizen's" is an ASCII `'` and
 * the string uses double quotes because of it.
 *
 * NOT the same thing as the organisation. `SITE_CURATOR` names the body that puts
 * the collection together, which the client described as "the SC Speakers Bureau
 * Curator". Keeping the two apart is deliberate: a reader who sees "The Citizen's
 * Reading Room" at the top and "SC Speakers Bureau" in the byline should be able to
 * tell that one is the publication and the other is the curator, rather than having
 * to guess whether they are two names for one thing.
 */
export const SITE_NAME = "The Citizen's Reading Room";

/**
 * The byline above the masthead name, chosen by the client 2026-10-05, replacing
 * the placeholder "A reading room".
 */
export const SITE_CURATOR = 'By the SC Speakers Bureau Curator';

/**
 * One line of positioning, shown under the name in the masthead.
 * PROVISIONAL - see the note above. The name is now chosen; this line is not.
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