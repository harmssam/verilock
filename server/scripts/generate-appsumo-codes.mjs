#!/usr/bin/env node
/**
 * Generate AppSumo (or other campaign) redemption codes.
 *
 * Produces:
 *   1. A single-column CSV (no header) for AppSumo upload
 *   2. Optional insert into the local/production SQLite DB
 *
 * Usage (from server/):
 *   node --import tsx scripts/generate-appsumo-codes.mjs
 *   node --import tsx scripts/generate-appsumo-codes.mjs --count 2000 --insert
 *   node --import tsx scripts/generate-appsumo-codes.mjs --count 1000 --out ../submission-assets/appsumo-codes.csv
 *
 * Flags:
 *   --count N       Number of codes (1000–10000 for AppSumo; default 1000)
 *   --credits N     Credits per code (default 500, or REDEEM_DEFAULT_CREDITS)
 *   --campaign S    Campaign label (default appsumo)
 *   --out PATH      CSV output path
 *   --insert        Insert generated codes into the DB (DATA_DIR / default path)
 *   --batch ID      Batch id tag (default timestamp)
 *   --prefix S      Code prefix (default VLAS) — stored without separators
 *
 * CSV format (AppSumo):
 *   - One column, no header
 *   - 3–200 chars, randomized, no duplicates
 *   - Codes shown with hyphens for readability (VLAS-XXXX-XXXX-XXXX);
 *     the app accepts pasted codes with or without separators.
 */
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseArgs(argv) {
  const out = {
    count: 1000,
    credits: Number(process.env.REDEEM_DEFAULT_CREDITS ?? 500) || 500,
    campaign: 'appsumo',
    out: null,
    insert: false,
    batch: null,
    prefix: 'VLAS',
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--count') out.count = Number(argv[++i])
    else if (a === '--credits') out.credits = Number(argv[++i])
    else if (a === '--campaign') out.campaign = String(argv[++i] ?? 'appsumo')
    else if (a === '--out') out.out = String(argv[++i] ?? '')
    else if (a === '--insert') out.insert = true
    else if (a === '--batch') out.batch = String(argv[++i] ?? '')
    else if (a === '--prefix') out.prefix = String(argv[++i] ?? 'VLAS').toUpperCase()
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: generate-appsumo-codes.mjs [--count 1000] [--credits 500] [--insert] [--out path.csv]`)
      process.exit(0)
    }
  }
  return out
}

/** Crockford-ish alphabet: no I, L, O, U (ambiguous). */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomSegment(len) {
  const bytes = randomBytes(len)
  let s = ''
  for (let i = 0; i < len; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length]
  }
  return s
}

/**
 * Storage key: PREFIX + 12 random chars (compact, no separators).
 * Display / CSV: PREFIX-XXXX-XXXX-XXXX
 */
function generateCodePair(prefix) {
  const body = randomSegment(12)
  const compact = `${prefix}${body}`.toUpperCase().replace(/[^A-Z0-9]/g, '')
  // Group body into 4-char chunks for AppSumo CSV readability.
  const chunks = body.match(/.{1,4}/g) ?? [body]
  const display = `${prefix}-${chunks.join('-')}`
  return { compact, display }
}

function formatForCsv(display) {
  // AppSumo: plain text, one code per line, no CSV quoting needed for our charset.
  return display
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const count = Math.floor(args.count)
  if (!Number.isFinite(count) || count < 1) {
    console.error('--count must be a positive integer')
    process.exit(1)
  }
  if (count > 10_000) {
    console.error('AppSumo max is 10,000 codes per upload; refuse --count > 10000')
    process.exit(1)
  }
  if (count < 1000) {
    console.warn(`Warning: AppSumo requires min 1000 codes; generating ${count} anyway.`)
  }

  const credits = Math.floor(args.credits)
  if (!Number.isFinite(credits) || credits < 1) {
    console.error('--credits must be a positive integer')
    process.exit(1)
  }

  const prefix = String(args.prefix || 'VLAS')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8) || 'VLAS'

  const batchId = args.batch?.trim() || `appsumo-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`
  const compactSet = new Set()
  const pairs = []

  // Over-generate slightly in case of rare collisions within the batch.
  let guard = 0
  while (pairs.length < count && guard < count * 5) {
    guard++
    const pair = generateCodePair(prefix)
    if (compactSet.has(pair.compact)) continue
    if (pair.compact.length < 3 || pair.compact.length > 200) {
      console.error('Generated code length out of AppSumo range; adjust --prefix')
      process.exit(1)
    }
    compactSet.add(pair.compact)
    pairs.push(pair)
  }

  if (pairs.length < count) {
    console.error(`Could only generate ${pairs.length}/${count} unique codes`)
    process.exit(1)
  }

  // Shuffle so CSV order is not generation order.
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[pairs[i], pairs[j]] = [pairs[j], pairs[i]]
  }

  const defaultOut = resolve(
    __dirname,
    '../../submission-assets',
    `appsumo-codes-${batchId}.csv`,
  )
  const outPath = resolve(args.out?.trim() || defaultOut)
  mkdirSync(dirname(outPath), { recursive: true })

  const csvBody = pairs.map(p => formatForCsv(p.display)).join('\n') + '\n'
  writeFileSync(outPath, csvBody, 'utf8')
  console.log(`Wrote ${pairs.length} codes → ${outPath}`)
  console.log(`  campaign=${args.campaign}  credits=${credits}  batch=${batchId}`)
  console.log(`  sample: ${pairs[0].display}  (stored as ${pairs[0].compact})`)

  if (args.insert) {
    const { insertRedemptionCodes, countRedemptionCodes } = await import('../src/db.ts')
    const result = insertRedemptionCodes(
      pairs.map(p => ({
        code: p.compact,
        campaign: args.campaign,
        credits,
        batchId,
      })),
    )
    const stats = countRedemptionCodes(args.campaign)
    console.log(`DB insert: ${result.inserted} new, ${result.skipped} skipped (already present)`)
    console.log(
      `Campaign "${args.campaign}" totals: available=${stats.available} redeemed=${stats.redeemed} total=${stats.total}`,
    )
  } else {
    console.log('DB not updated (pass --insert to load codes into this environment’s database).')
    console.log('On production: run the same command with DATA_DIR pointing at prod data, or use import-redemption-codes.mjs')
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
