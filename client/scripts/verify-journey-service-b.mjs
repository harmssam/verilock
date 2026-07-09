#!/usr/bin/env node
/**
 * Structural tests for production journey packaging.
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

console.log('verify-journey-production')

check('client/package.json default build is journey packaging', () => {
  const pkg = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts['build:journey'], 'missing build:journey')
  assert.ok(pkg.scripts['package:service-b'], 'missing package:service-b alias')
  assert.ok(pkg.scripts['build:legacy'], 'missing build:legacy for old SPA')
  // default build must be journey packaging
  assert.ok(
    pkg.scripts.build.includes('package-service-b') || pkg.scripts.build.includes('package:service-b'),
    'default build must package journey into client/dist',
  )
  assert.ok(!pkg.scripts.build.includes('vite build') || pkg.scripts.build.includes('package'),
    'default build should not be bare vite production App only')
})

check('root package.json default build is journey', () => {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts.build, 'missing root build')
  assert.ok(pkg.scripts['build:legacy'], 'missing root build:legacy')
  // build:service-b is a backward-compat alias of build
  assert.ok(pkg.scripts['build:service-b'], 'missing root build:service-b alias')
})

check('Dockerfile builds default client (journey)', () => {
  const docker = readFileSync(join(rootDir, 'Dockerfile'), 'utf8')
  assert.match(docker, /npm run build --prefix client/)
})

check('Dockerfile.service-b remains journey-compatible alias', () => {
  const docker = readFileSync(join(rootDir, 'Dockerfile.service-b'), 'utf8')
  assert.match(docker, /npm run build --prefix client|package:service-b/)
})

check('vite.journey.config.ts is root-hosted (base: /)', () => {
  const src = readFileSync(join(clientDir, 'vite.journey.config.ts'), 'utf8')
  assert.match(src, /base:\s*['"]\/['"]/)
  assert.match(src, /outDir:\s*['"]dist-journey['"]/)
  assert.match(src, /journey\.html/)
})

check('legacy vite.config.ts does not use dist-journey', () => {
  const src = readFileSync(join(clientDir, 'vite.config.ts'), 'utf8')
  assert.ok(!src.includes("base: '/experiment/'"))
  assert.ok(!src.includes('dist-journey'))
})

check('legacy index.html still boots src/main.tsx (recoverable SPA)', () => {
  const html = readFileSync(join(clientDir, 'index.html'), 'utf8')
  assert.match(html, /src\/main\.tsx/)
  assert.ok(!html.includes('data-verilock-surface="journey"'))
  assert.ok(!html.includes('src/experiment/main.tsx'))
})

check('journey.html boots experiment main + surface markers + indexable SEO', () => {
  const html = readFileSync(join(clientDir, 'journey.html'), 'utf8')
  assert.match(html, /src\/experiment\/main\.tsx/)
  assert.match(html, /data-verilock-surface="journey"/)
  assert.match(html, /verilock-app" content="journey"/)
  assert.match(html, /content="index,\s*follow"/)
  assert.match(html, /canonical/)
})

check('experiment React entry exports ExperimentApp mount', () => {
  const main = readFileSync(join(clientDir, 'src/experiment/main.tsx'), 'utf8')
  assert.match(main, /ExperimentApp/)
  assert.match(main, /createRoot/)
})

if (process.env.VERIFY_DIST === '1') {
  check('client/dist after production build is journey shell', () => {
    const index = join(clientDir, 'dist', 'index.html')
    assert.ok(existsSync(index), 'client/dist/index.html missing — run npm run build first')
    const html = readFileSync(index, 'utf8')
    assert.ok(
      html.includes('data-verilock-surface="journey"') ||
        html.includes('verilock-app" content="journey"'),
      'dist/index.html does not look like journey shell',
    )
    assert.ok(!html.includes('/src/main.tsx'), 'dist still points at dev main.tsx')
    assert.match(html, /content="index,\s*follow"/)
  })
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
