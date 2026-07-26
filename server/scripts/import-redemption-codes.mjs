#!/usr/bin/env node
/**
 * Import a single-column AppSumo-style CSV into the redemption_codes table.
 *
 * Usage (from server/):
 *   node --import tsx scripts/import-redemption-codes.mjs path/to/codes.csv
 *   node --import tsx scripts/import-redemption-codes.mjs codes.csv --credits 500 --campaign appsumo
 *
 * Codes are normalized (uppercase, strip hyphens/spaces) before insert.
 * Duplicates are skipped.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

function parseArgs(argv) {
  const out = {
    file: null,
    credits: Number(process.env.REDEEM_DEFAULT_CREDITS ?? 500) || 500,
    campaign: 'appsumo',
    batch: null,
  }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--credits') out.credits = Number(argv[++i])
    else if (a === '--campaign') out.campaign = String(argv[++i] ?? 'appsumo')
    else if (a === '--batch') out.batch = String(argv[++i] ?? '')
    else if (a === '--help' || a === '-h') {
      console.log('Usage: import-redemption-codes.mjs <codes.csv> [--credits 500] [--campaign appsumo]')
      process.exit(0)
    } else if (!a.startsWith('-')) positional.push(a)
  }
  out.file = positional[0] ?? null
  return out
}

function normalize(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.file) {
    console.error('Missing CSV path. Example: import-redemption-codes.mjs ../submission-assets/appsumo-codes.csv --credits 500')
    process.exit(1)
  }

  const path = resolve(args.file)
  const text = readFileSync(path, 'utf8')
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)

  // Skip accidental header rows
  const codes = []
  const seen = new Set()
  for (const line of lines) {
    // Single column only; if someone used CSV with commas, take first cell.
    const cell = line.split(',')[0]?.trim() ?? ''
    if (!cell || /^code$/i.test(cell)) continue
    const n = normalize(cell)
    if (n.length < 3 || n.length > 200) {
      console.warn(`Skipping out-of-range code: ${cell.slice(0, 40)}`)
      continue
    }
    if (seen.has(n)) continue
    seen.add(n)
    codes.push(n)
  }

  if (codes.length === 0) {
    console.error('No codes found in file')
    process.exit(1)
  }

  const credits = Math.floor(args.credits)
  if (!Number.isFinite(credits) || credits < 1) {
    console.error('--credits must be a positive integer')
    process.exit(1)
  }

  const batchId =
    args.batch?.trim() || `import-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`

  const { insertRedemptionCodes, countRedemptionCodes } = await import('../src/db.ts')
  const result = insertRedemptionCodes(
    codes.map(code => ({
      code,
      campaign: args.campaign,
      credits,
      batchId,
    })),
  )
  const stats = countRedemptionCodes(args.campaign)
  console.log(`Imported from ${path}`)
  console.log(`  file lines: ${lines.length}  unique codes: ${codes.length}`)
  console.log(`  inserted: ${result.inserted}  skipped: ${result.skipped}`)
  console.log(
    `  campaign "${args.campaign}": available=${stats.available} redeemed=${stats.redeemed} total=${stats.total}`,
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
