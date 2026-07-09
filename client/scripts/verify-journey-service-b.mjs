#!/usr/bin/env node
/**
 * Structural tests for service-B journey packaging.
 * Drives real shipped files (configs, HTML entry, package scripts).
 * Run: node scripts/verify-journey-service-b.mjs
 * Optional: VERIFY_DIST=1 after package:service-b to assert client/dist content.
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

console.log('verify-journey-service-b')

check('client/package.json has build:journey and package:service-b', () => {
  const pkg = JSON.parse(readFileSync(join(clientDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts['build:journey'], 'missing build:journey')
  assert.ok(pkg.scripts['package:service-b'], 'missing package:service-b')
  assert.equal(pkg.scripts.build.includes('vite build') || pkg.scripts.build.includes('tsc'), true)
  // default build must NOT invoke journey packaging
  assert.ok(!pkg.scripts.build.includes('package:service-b'))
  assert.ok(!pkg.scripts.build.includes('build:journey'))
})

check('root package.json has build:service-b override path', () => {
  const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'))
  assert.ok(pkg.scripts['build:service-b'], 'missing root build:service-b')
  assert.ok(!pkg.scripts.build.includes('build:service-b'), 'default build must stay service A')
})

check('vite.journey.config.ts is root-hosted (base: /)', () => {
  const src = readFileSync(join(clientDir, 'vite.journey.config.ts'), 'utf8')
  assert.match(src, /base:\s*['"]\/['"]/)
  assert.match(src, /outDir:\s*['"]dist-journey['"]/)
  assert.match(src, /journey\.html/)
})

check('default vite.config.ts remains production SPA role', () => {
  const src = readFileSync(join(clientDir, 'vite.config.ts'), 'utf8')
  assert.ok(!src.includes("base: '/experiment/'"))
  // no journey-only outDir as default
  assert.ok(!src.includes('dist-journey'))
})

check('production index.html still boots src/main.tsx', () => {
  const html = readFileSync(join(clientDir, 'index.html'), 'utf8')
  assert.match(html, /src\/main\.tsx/)
  assert.ok(!html.includes('data-verilock-surface="journey"'))
  assert.ok(!html.includes('src/experiment/main.tsx'))
})

check('journey.html boots experiment main + surface markers', () => {
  const html = readFileSync(join(clientDir, 'journey.html'), 'utf8')
  assert.match(html, /src\/experiment\/main\.tsx/)
  assert.match(html, /data-verilock-surface="journey"/)
  assert.match(html, /verilock-app" content="journey"/)
})

check('experiment React entry exports ExperimentApp mount', () => {
  const main = readFileSync(join(clientDir, 'src/experiment/main.tsx'), 'utf8')
  assert.match(main, /ExperimentApp/)
  assert.match(main, /createRoot/)
})

if (process.env.VERIFY_DIST === '1') {
  check('client/dist after package:service-b is journey shell', () => {
    const index = join(clientDir, 'dist', 'index.html')
    assert.ok(existsSync(index), 'client/dist/index.html missing — run package:service-b first')
    const html = readFileSync(index, 'utf8')
    assert.match(html, /journey|ExperimentApp|experiment/i)
    assert.ok(
      html.includes('data-verilock-surface="journey"') ||
        html.includes('verilock-app" content="journey"') ||
        html.includes('VeriLock Journey'),
      'dist/index.html does not look like journey shell',
    )
    // Must not be a pure production-only title without journey markers
    assert.ok(!html.includes('/src/main.tsx'), 'dist still points at dev main.tsx')
  })
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed`)
  process.exit(1)
}
console.log('\nAll checks passed')
