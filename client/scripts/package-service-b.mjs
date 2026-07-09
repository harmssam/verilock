#!/usr/bin/env node
/**
 * Production packaging: journey SPA → client/dist for Express static serve.
 *
 * Usage (from client/): node scripts/package-service-b.mjs
 * Or: npm run build --prefix client
 * Alias: npm run package:service-b --prefix client
 */
import { cpSync, existsSync, mkdirSync, renameSync, rmSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const distJourney = join(clientDir, 'dist-journey')
const dist = join(clientDir, 'dist')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: clientDir, stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

console.log('[production] Building journey SPA (base: /)…')
run('npx', ['tsc', '-b'])
run('npx', ['vite', 'build', '--config', 'vite.journey.config.ts'])

// Ensure root index.html (Vite MPA may emit journey.html; plugin + this fallback)
const journeyHtml = join(distJourney, 'journey.html')
const indexHtml = join(distJourney, 'index.html')
if (existsSync(journeyHtml)) {
  if (existsSync(indexHtml)) unlinkSync(indexHtml)
  renameSync(journeyHtml, indexHtml)
}

if (!existsSync(indexHtml)) {
  console.error('[production] Missing dist-journey/index.html after journey build')
  process.exit(1)
}

const html = readFileSync(join(distJourney, 'index.html'), 'utf8')
if (!html.includes('data-verilock-surface="journey"') && !html.includes('verilock-app" content="journey"')) {
  console.error('[production] Journey index.html missing journey surface markers')
  process.exit(1)
}

console.log('[production] Installing journey build into client/dist …')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(distJourney, dist, { recursive: true })

console.log('[production] Ready: client/dist/index.html is the journey shell')
console.log('[production] Start server with NODE_ENV=production')
