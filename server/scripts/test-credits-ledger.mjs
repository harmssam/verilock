import { mkdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const dir = join(tmpdir(), `verilock-credit-test-${randomUUID()}`)
mkdirSync(dir, { recursive: true })
process.env.DATA_DIR = dir

const { applyCreditDelta, getCreditBalance } = await import('../src/db.ts')

const wallet = 'NQ070000000000000000000000000000000000'
const r1 = applyCreditDelta({
  id: randomUUID(),
  walletAddress: wallet,
  delta: 5,
  kind: 'topup_nim',
  idempotencyKey: 'test-mint-1',
  refTxHash: 'aa'.repeat(32),
  nimLuna: 250_000_000,
})
console.log('mint', r1.balance, r1.created)
if (r1.balance !== 5 || !r1.created) throw new Error('mint failed')

const r2 = applyCreditDelta({
  id: randomUUID(),
  walletAddress: wallet,
  delta: 5,
  kind: 'topup_nim',
  idempotencyKey: 'test-mint-1',
  refTxHash: 'aa'.repeat(32),
})
console.log('idempotent', r2.balance, r2.created)
if (r2.balance !== 5 || r2.created) throw new Error('idempotent mint failed')

const r3 = applyCreditDelta({
  id: randomUUID(),
  walletAddress: wallet,
  delta: -1,
  kind: 'spend',
  idempotencyKey: 'hold:doc1:1',
  refDocumentId: 'doc1',
})
console.log('spend', r3.balance)
if (r3.balance !== 4) throw new Error('spend failed')

let threw = false
try {
  applyCreditDelta({
    id: randomUUID(),
    walletAddress: wallet,
    delta: -10,
    kind: 'spend',
    idempotencyKey: 'hold:over:1',
  })
} catch (e) {
  threw = true
  console.log('insufficient ok', e.message)
}
if (!threw) throw new Error('expected insufficient credits')

console.log('final', getCreditBalance(wallet))
rmSync(dir, { recursive: true, force: true })
console.log('OK')
