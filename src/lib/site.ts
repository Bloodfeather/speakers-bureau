// src/lib/site.ts - site-wide identity, and the one place that knows about the
// deployment base path.
//
// ---------------------------------------------------------------------------
// WHAT IS STILL UNRESOLVED, and it is not a string in this file
// ---------------------------------------------------------------------------
//
// Every string in this file is either supplied by the client or stated from the
// dataset. Nothing here is a stand-in waiting to be replaced: a reader cannot tell
// a placeholder from a real claim, so a placeholder that ships is a lie with a
// disclaimer attached.
//
// The `site` value in astro.config.mjs is still https://example.org. That must be
// set to the real domain before publication, or canonical and social URLs point at
// example.org.
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
 * The publication's name. The apostrophe in "Citizen's" is an ASCII `'` and the
 * string uses double quotes because of it.
 *
 * NOT the same thing as the organisation. `SITE_CURATOR_ATTRIBUTION` names the
 * body that produces the collection, which the client described as "the SC
 * Speakers Bureau Curator". Keeping the two apart is deliberate: a reader who sees
 * "The Citizen's Reading Room" in the masthead and "SC Speakers Bureau" in the
 * footer should be able to tell that one is the publication and the other its
 * editor, rather than having to guess whether they are two names for one thing.
 */
export const SITE_NAME = "The Citizen's Reading Room";

/**
 * The curator credit, shown ONCE, in the site footer only.
 *
 * The client is the curator AND the webmaster and does not want the title in the
 * masthead, so there is one credit in one place rather than a name repeated on
 * every page.
 *
 * Pre-worded here rather than assembled by the footer, so there is exactly one
 * sentence to change if the credit ever changes.
 */
export const SITE_CURATOR_ATTRIBUTION =
  'Curated and maintained by the SC Speakers Bureau Curator.';

/**
 * One line of positioning, shown under the name in the masthead.
 *
 * Cut down from the Bureau's own sentence - "the SC Speakers Bureau creates
 * engaging and educational events with speakers who inform and educate local
 * citizens" - because a masthead line has to be one line. It is the client's
 * wording, not project copy, which is why it carries no provisional marker.
 */
export const SITE_TAGLINE = 'Speakers who inform and educate local citizens.';

/**
 * The short honest paragraph on the home page.
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

// NOTE: SITE_TITLE_SUFFIX is currently imported by nothing. It was written for
// page titles that read "Latest writing - The Citizen's Reading Room", and no page
// ended up doing that. It is kept because a page title on this site should name
// the site somewhere, and adding the suffix is a one-line change per page. If a
// title ever does need it, that is the moment to delete this note.
