import { defineConfig } from 'astro/config'

// `site` is the real domain. Astro needs it to build absolute URLs (canonical,
// sitemap, RSS, social previews). It was `https://example.org` until the client
// chose scspeakersbureau.org; `example.org` is on the forbidden-phrase list in
// test/no-process-notes.test.mjs precisely so it cannot creep back into a built
// page. If the domain changes, this line and that test's comment are the only
// two places to change.
//
// WHY `base` IS STILL READ FROM THE ENVIRONMENT, THOUGH CLOUDFLARE PAGES NEVER
// NEEDS A SUBPATH.
//
// The site is deployed to Cloudflare Pages, which serves from the root of the
// domain, so the correct value here is always "/" and BASE_PATH is never set in
// CI. The override is kept for one reason: the deploy job FAILS LOUDLY if
// BASE_PATH is set (see .github/workflows/refresh.yml), and that guard is only
// meaningful if this line still reads the variable. Deleting the override would
// turn that guard into dead code and quietly re-open the failure it prevents -
// every asset URL served from a subpath that does not exist on this platform.
//
// Hardcoding `base: '/'` here would be shorter and would also delete the ability
// to detect the mistake. The variable is the detector.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  site: 'https://scspeakersbureau.org',
  base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
})
