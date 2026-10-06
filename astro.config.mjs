import { defineConfig } from 'astro/config'

// `site` is a PLACEHOLDER. Astro needs it to build absolute URLs (sitemap,
// canonical, RSS). Replace it with the real domain before the site goes live.
//
// NOTE for GitHub Pages: a project site (https://<user>.github.io/<repo>/)
// is served from a subpath. If that subpath is hardcoded here, local `astro dev`
// serves the wrong URLs and every absolute link breaks in dev. So the subpath
// comes from the environment: local dev leaves BASE_PATH unset and gets "/",
// CI sets BASE_PATH=/<repo-name>.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  // Placeholder domain - see note above.
  site: 'https://example.org',
  base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
})
