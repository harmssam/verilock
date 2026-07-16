#!/usr/bin/env node
/**
 * Structural tests for production packaging.
 * Drives real shipped files (configs, HTML entry, package scripts).
 * Run: node scripts/verify-journey-service-b.mjs
 * Optional: VERIFY_DIST=1 after npm run build to assert client/dist content.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const rootDir = join(clientDir, '..')
let failed = 0

function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (e) {
    failed++
    console.error(`  FAIL ${name}`)
    console.error(`       ${e.message}`)
  }
}

console.log('verify-production')

check('client/package.json default build packages SPA into client/dist', () => {
  const pkg = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts['package:service-b'], 'missing package:service-b alias')
  assert.ok(
    pkg.scripts.build.includes('package-service-b') || pkg.scripts.build.includes('package:service-b'),
    'default build must package SPA into client/dist',
  )
  assert.equal(pkg.scripts.dev, 'vite', 'default dev should use vite.config.ts')
  assert.ok(!pkg.scripts['dev:landing-redesign'], 'parallel landing-redesign dev must be removed')
  assert.ok(!pkg.scripts['dev:legacy'], 'legacy dev must be removed')
  assert.ok(!pkg.scripts['build:legacy'], 'legacy build must be removed')
})

check('root package.json default build is production SPA', () => {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts.build, 'missing root build')
  assert.ok(pkg.scripts['build:service-b'], 'missing root build:service-b alias')
  assert.ok(!pkg.scripts['dev:legacy'], 'root legacy dev must be removed')
  assert.ok(!pkg.scripts['build:legacy'], 'root legacy build must be removed')
})

check('Dockerfile builds default client', () => {
  const docker = readFileSync(join(rootDir, 'Dockerfile'), 'utf8')
  assert.match(docker, /npm run build --prefix client/)
})

check('Dockerfile.service-b remains production-compatible alias', () => {
  const docker = readFileSync(join(rootDir, 'Dockerfile.service-b'), 'utf8')
  assert.match(docker, /npm run build --prefix client|package:service-b/)
})

check('vite.config.ts is sole root-hosted production config', () => {
  const src = readFileSync(join(clientDir, 'vite.config.ts'), 'utf8')
  assert.match(src, /base:\s*['"]\/['"]/)
  assert.match(src, /outDir:\s*['"]dist-journey['"]/)
  assert.match(src, /index\.html/)
  assert.ok(!existsSync(join(clientDir, 'vite.journey.config.ts')), 'vite.journey.config.ts should be removed')
  assert.ok(!existsSync(join(clientDir, 'vite.landing-redesign.config.ts')), 'vite.landing-redesign.config.ts should be removed')
  assert.ok(!existsSync(join(clientDir, 'vite.experiment.config.ts')), 'vite.experiment.config.ts should be removed')
})

check('index.html boots production App + surface markers + indexable SEO', () => {
  const html = readFileSync(join(clientDir, 'index.html'), 'utf8')
  assert.match(html, /src\/main\.tsx/)
  assert.match(html, /data-verilock-surface="journey"/)
  assert.match(html, /verilock-app" content="journey"/)
  assert.match(html, /content="index,\s*follow"/)
  assert.match(html, /canonical/)
  assert.ok(!html.includes('noindex'), 'production HTML must not noindex')
  assert.ok(!existsSync(join(clientDir, 'journey.html')), 'journey.html should be removed')
  assert.ok(!existsSync(join(clientDir, 'landing-redesign.html')), 'landing-redesign.html should be removed')
  assert.ok(!existsSync(join(clientDir, 'experiment.html')), 'experiment.html should be removed')
})

check('production React entry mounts App (light shell)', () => {
  const main = readFileSync(join(clientDir, 'src/main.tsx'), 'utf8')
  assert.match(main, /from ['"]\.\/App['"]/)
  assert.match(main, /createRoot/)
  assert.ok(!main.includes('ExperimentApp'), 'entry must not mount navy ExperimentApp')
})

check('product modules live under src/journey and shell under App', () => {
  assert.ok(existsSync(join(clientDir, 'src/journey/DocumentJourney.tsx')))
  assert.ok(existsSync(join(clientDir, 'src/App.tsx')))
  assert.ok(existsSync(join(clientDir, 'src/landing/LandingHome.tsx')))
  assert.ok(!existsSync(join(clientDir, 'src/experiment')), 'src/experiment should be renamed')
  assert.ok(!existsSync(join(clientDir, 'src/landing-redesign')), 'src/landing-redesign should be removed')
  const app = readFileSync(join(clientDir, 'src/App.tsx'), 'utf8')
  assert.match(app, /DocumentJourney/)
  assert.ok(!app.includes('BlogPage'), 'production shell must not mount BlogPage')
  assert.ok(!app.includes('lr-preview-banner'), 'preview banner must not ship')
})

check('archives and blog are excluded from GitHub / production wiring', () => {
  const gi = readFileSync(join(rootDir, '.gitignore'), 'utf8')
  assert.match(gi, /client\/src\/archive\//)
  assert.match(gi, /client\/src\/blog\//)
  assert.match(gi, /client\/public\/blog\//)
  const app = readFileSync(join(clientDir, 'src/App.tsx'), 'utf8')
  assert.ok(!app.includes("from './blog'"), 'App must not import blog modules')
  assert.ok(!app.includes('BlogPage'), 'App must not mount BlogPage')
  const hub = readFileSync(join(clientDir, 'src/hubReturnPath.ts'), 'utf8')
  assert.ok(!hub.includes('isBlogPath'), 'blog paths are not known app routes')
  const sitemap = readFileSync(join(clientDir, 'public/sitemap.xml'), 'utf8')
  assert.ok(!sitemap.includes('/blog'), 'sitemap must not list blog URLs')
  const css = readFileSync(join(clientDir, 'src/App.css'), 'utf8')
  assert.ok(!css.includes('lr-preview-banner'), 'preview banner CSS must be removed')
  assert.ok(!css.includes('lr-blog-latest'), 'blog-latest CSS must be removed')
})

if (process.env.VERIFY_DIST === '1') {
  check('client/dist after production build is indexable journey shell', () => {
    const index = join(clientDir, 'dist', 'index.html')
    assert.ok(existsSync(index), 'client/dist/index.html missing — run npm run build first')
    const html = readFileSync(index, 'utf8')
    assert.ok(
      html.includes('data-verilock-surface="journey"') ||
        html.includes('verilock-app" content="journey"'),
      'dist/index.html missing journey surface markers',
    )
    assert.ok(!html.includes('/src/main.tsx'), 'dist still points at dev main.tsx')
    assert.match(html, /content="index,\s*follow"/)
    assert.ok(!html.includes('noindex'), 'dist must not noindex')
    assert.ok(!html.includes('Landing redesign preview'), 'dist still has preview chrome')
    assert.ok(!existsSync(join(clientDir, 'dist', 'blog')), 'dist must not ship blog assets')
  })
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
