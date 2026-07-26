/**
 * Smoke test: generate → insert → redeem → reject double-redeem.
 * Run from server/: node --import tsx scripts/test-redeem-codes.mjs
 */
import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = join(tmpdir(), `verilock-redeem-test-${randomUUID()}`)
mkdirSync(dir, { recursive: true })
process.env.DATA_DIR = dir
process.env.CREDITS_ENABLED = '1'
process.env.NODE_ENV = 'development'

const {
  insertRedemptionCodes,
  getCreditBalance,
  getRedemptionCode,
} = await import('../src/db.ts')
const { redeemCodeForWallet, normalizeRedeemCode } = await import('../src/redeemCodes.ts')

const wallet = 'NQ070000000000000000000000000000000000'
const compact = 'VLAS7A9K2M4X8B3N'
const display = 'VLAS-7A9K-2M4X-8B3N'

const ins = insertRedemptionCodes([
  { code: compact, campaign: 'appsumo', credits: 500, batchId: 'test' },
])
if (ins.inserted !== 1) throw new Error('insert failed')

// Redeem with hyphenated paste form
const r1 = redeemCodeForWallet(display, wallet)
console.log('redeem', r1.balance, r1.creditsMinted)
if (r1.balance !== 500 || r1.creditsMinted !== 500) throw new Error('mint failed')

const row = getRedemptionCode(compact)
if (row?.status !== 'redeemed') throw new Error('code not marked redeemed')

let threw = false
try {
  redeemCodeForWallet(display, wallet)
} catch (e) {
  threw = true
  console.log('double-redeem blocked:', e.message)
}
if (!threw) throw new Error('expected double-redeem error')

// Second wallet cannot steal used code
const wallet2 = 'NQ080000000000000000000000000000000000'
threw = false
try {
  redeemCodeForWallet(compact, wallet2)
} catch (e) {
  threw = true
  console.log('other wallet blocked:', e.message)
}
if (!threw) throw new Error('expected already-redeemed for second wallet')

if (getCreditBalance(wallet2) !== 0) throw new Error('wallet2 should have 0')
if (normalizeRedeemCode('  vlas-7a9k-2m4x-8b3n  ') !== compact) {
  throw new Error('normalize mismatch')
}

console.log('final balance', getCreditBalance(wallet))
rmSync(dir, { recursive: true, force: true })
console.log('OK')
