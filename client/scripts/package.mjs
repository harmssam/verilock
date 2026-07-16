#!/usr/bin/env node
/**
 * Production packaging: SPA → client/dist for Express static serve.
 *
 * Usage (from client/): node scripts/package.mjs
 * Or: npm run build --prefix client
 *
 * Legacy alias (Railway / old scripts): npm run package:service-b
 */
import { cpSync, existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..')
/** Vite intermediate outDir (copied to dist below). */
const distBuild = join(clientDir, 'dist-build')
const dist = join(clientDir, 'dist')

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: clientDir, stdio: 'inherit', shell: false })
  if (r.status !== 0) {
    process.exit(r.status ?? 1)
  }
}

console.log('[production] Building SPA (base: /)…')
run('npx', ['tsc', '-b'])
run('npx', ['vite', 'build'])

const indexHtml = join(distBuild, 'index.html')
if (!existsSync(indexHtml)) {
  console.error('[production] Missing dist-build/index.html after build')
  process.exit(1)
}

const html = readFileSync(indexHtml, 'utf8')
if (!html.includes('data-verilock-surface="journey"') && !html.includes('verilock-app" content="journey"')) {
  console.error('[production] index.html missing journey surface markers')
  process.exit(1)
}
if (html.includes('noindex')) {
  console.error('[production] index.html must be indexable (found noindex)')
  process.exit(1)
}
if (html.includes('lr-preview-banner') || html.includes('Landing redesign preview')) {
  console.error('[production] dist still contains redesign preview chrome')
  process.exit(1)
}

// Blog is local-only / gitignored; strip if a dirty local public/blog was copied.
for (const dir of [distBuild, dist]) {
  const blogDir = join(dir, 'blog')
  if (existsSync(blogDir)) {
    console.log(`[production] Stripping leftover ${blogDir.replace(clientDir + '/', '')}/ …`)
    rmSync(blogDir, { recursive: true, force: true })
  }
}

console.log('[production] Installing build into client/dist …')
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })
cpSync(distBuild, dist, { recursive: true })

// Re-strip after copy in case anything reappeared
const distBlog = join(dist, 'blog')
if (existsSync(distBlog)) {
  rmSync(distBlog, { recursive: true, force: true })
}

console.log('[production] Ready: client/dist/index.html is the production shell')
console.log('[production] Start server with NODE_ENV=production')
