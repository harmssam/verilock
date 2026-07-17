/**
 * Verify annotations column + sanitize (no PDF bytes, nullable legacy docs).
 * Run: node scripts/test-annotations.mjs  (from server/)
 */
import { randomUUID } from 'node:crypto'

const { sanitizeAnnotations } = await import('../src/security.ts')
const { insertDocument, getDocumentById } = await import('../src/db.ts')

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('ok:', msg)
  }
}

// 1) empty / null → null
assert(sanitizeAnnotations(null) === null, 'null annotations → null')
assert(sanitizeAnnotations([]) === null, 'empty array → null')

// 2) valid text annotation
const textAnn = sanitizeAnnotations([
  {
    id: 't1',
    type: 'text',
    pageIndex: 1,
    x: 0.05,
    y: 0.05,
    width: 0.3,
    height: 0.08,
    text: 'Top-left page 2',
  },
])
assert(Array.isArray(textAnn) && textAnn.length === 1, 'text annotation stored')
assert(textAnn[0].text === 'Top-left page 2', 'text preserved')
assert(textAnn[0].x === 0.05 && textAnn[0].y === 0.05, 'geometry preserved')

// 3) valid signature (tiny 1x1 PNG)
const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const sigAnn = sanitizeAnnotations([
  {
    id: 's1',
    type: 'signature',
    pageIndex: 0,
    x: 0.7,
    y: 0.85,
    width: 0.22,
    height: 0.08,
    imageDataUrl: `data:image/png;base64,${tinyPng}`,
  },
])
assert(Array.isArray(sigAnn) && sigAnn[0].type === 'signature', 'signature annotation stored')

// 4) reject PDF-looking payload
let threw = false
try {
  sanitizeAnnotations([
    {
      type: 'signature',
      pageIndex: 0,
      x: 0,
      y: 0,
      width: 0.1,
      height: 0.1,
      imageDataUrl: 'JVBERi0xLjQK%PDF-1.4 fake',
    },
  ])
} catch {
  threw = true
}
assert(threw, 'rejects PDF-like annotation payload')

// 5) insert document WITHOUT annotations (nullable regression)
const idNoAnn = randomUUID()
const slugNo = idNoAnn.replace(/-/g, '').slice(0, 12)
const now = Date.now()
insertDocument({
  id: idNoAnn,
  slug: slugNo,
  title: 'No annotations legacy',
  originalFilename: 'legacy.pdf',
  type: 'other',
  status: 'draft',
  creatorAddress: 'NQXX TEST LEGACY ADDR 0000 0000 0000 0000 0000',
  originalSha256: 'a'.repeat(64),
  finalSha256: null,
  pageCount: 1,
  metadata: null,
  annotations: null,
  requiredSignatures: 1,
  createdAt: now,
  lockedAt: null,
  creatorNotifyEmail: null,
  readyToSealEmailSentAt: null,
  creatorDisplayName: null,
})
const loadedNo = getDocumentById(idNoAnn)
assert(loadedNo != null, 'legacy doc loads')
assert(loadedNo.annotations === null, 'legacy annotations column is null')

// 6) insert WITH annotations
const idAnn = randomUUID()
const slugAnn = idAnn.replace(/-/g, '').slice(0, 12)
insertDocument({
  id: idAnn,
  slug: slugAnn,
  title: 'With annotations',
  originalFilename: 'annotated.pdf',
  type: 'other',
  status: 'draft',
  creatorAddress: 'NQXX TEST ANNOT ADDR 0000 0000 0000 0000 0000',
  originalSha256: 'b'.repeat(64),
  finalSha256: null,
  pageCount: 2,
  metadata: null,
  annotations: textAnn.concat(sigAnn),
  requiredSignatures: 1,
  createdAt: now,
  lockedAt: null,
  creatorNotifyEmail: null,
  readyToSealEmailSentAt: null,
  creatorDisplayName: null,
})
const loadedAnn = getDocumentById(idAnn)
assert(loadedAnn != null, 'annotated doc loads')
assert(Array.isArray(loadedAnn.annotations) && loadedAnn.annotations.length === 2, 'annotations round-trip')
assert(loadedAnn.annotations[0].type === 'text', 'first is text')
assert(loadedAnn.annotations[1].type === 'signature', 'second is signature')
// corner placement check
assert(loadedAnn.annotations[1].x === 0.7 && loadedAnn.annotations[1].y === 0.85, 'bottom-right coords')
assert(loadedAnn.annotations[0].x === 0.05 && loadedAnn.annotations[0].pageIndex === 1, 'page2 top-left')

console.log(failed === 0 ? '\nAll annotation tests passed.' : `\n${failed} test(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
