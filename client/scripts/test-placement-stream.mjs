/**
 * Placement stream v2 core tests (pure JS, no Vite).
 * Mirrors client/src/pdf/placements.ts + placementStream.ts algorithms.
 *
 * Run: node scripts/test-placement-stream.mjs  (from client/)
 *   or: node client/scripts/test-placement-stream.mjs  (from repo root)
 */
import { createHash, webcrypto } from 'node:crypto'

const cryptoSubtle = webcrypto.subtle

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('ok:', msg)
  }
}

const ZERO_ROOT =
  '0000000000000000000000000000000000000000000000000000000000000000'
const STREAM_MAGIC = 0xa1
const STREAM_VERSION_V2 = 2
const FRAME_SIZE = 64
const FRAME_HEADER = 9
const FRAME_BODY = 55
const FRAME_HEAD = 1
const FRAME_DATA = 2
const FRAME_END = 3
const MAX_STREAM_FRAMES = 128

function q(n, digits = 4) {
  if (!Number.isFinite(n)) return 0
  const p = 10 ** digits
  return Math.round(n * p) / p
}
function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
function normalizeHex64(hex) {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new Error('expected 64 hex')
  return clean
}
function normalizeHex32(hex) {
  const clean = hex.replace(/^0x/i, '').toLowerCase()
  if (!/^[0-9a-f]{32}$/.test(clean)) throw new Error('expected 32 hex')
  return clean
}

async function sha256Hex(data) {
  const buf =
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  const digest = await cryptoSubtle.digest('SHA-256', buf)
  return Buffer.from(digest).toString('hex')
}

function kindToWire(kind) {
  return { signature: 's', name: 'n', text: 'x', checkmark: 'c', cross: 'k' }[kind] ?? 's'
}
function kindFromWire(k) {
  return { s: 'signature', n: 'name', x: 'text', c: 'checkmark', k: 'cross' }[k] ?? 'signature'
}

function canonicalizePlan(plan) {
  const people = [...plan.people]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(p => ({ i: p.slotIndex, n: String(p.displayName ?? '').trim().slice(0, 80) }))
  const places = [...plan.slots]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(s => ({
      id: s.id,
      p: s.personSlotIndex,
      k: kindToWire(s.kind),
      page: s.pageIndex | 0,
      x: q(clamp01(s.x)),
      y: q(clamp01(s.y)),
      w: q(Math.max(1e-9, clamp01(s.width))),
      h: q(Math.max(1e-9, clamp01(s.height))),
    }))
  // Match production placements.ts — always include creatorSigningAs as `cs`
  const row = { v: 2, pdf: normalizeHex64(plan.pdfSha256), people, places }
  if (plan.creatorSigningAs == null) row.cs = null
  else row.cs = plan.creatorSigningAs | 0
  return row
}

async function computePlanRoot(plan) {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(canonicalizePlan(plan))))
}

function canonicalizeBlobPayload(payload) {
  if (payload.kind === 'ink') {
    return {
      t: 'ink',
      path: {
        epsilon: q(payload.path.epsilon, 2),
        lineWidthRatio: q(payload.path.lineWidthRatio, 4),
        strokes: payload.path.strokes.map(s => ({
          points: s.points.map(pt => ({ x: q(pt.x), y: q(pt.y) })),
        })),
      },
    }
  }
  return { t: 'text', text: String(payload.text ?? '').slice(0, 500) }
}

async function computeBlobId(payload) {
  const full = await sha256Hex(
    new TextEncoder().encode(JSON.stringify(canonicalizeBlobPayload(payload))),
  )
  return full.slice(0, 32)
}

async function makeContentBlob(payload) {
  const blobId = await computeBlobId(payload)
  if (payload.kind === 'ink') {
    const c = canonicalizeBlobPayload(payload)
    return { blobId, payload: { kind: 'ink', path: c.path } }
  }
  const c = canonicalizeBlobPayload(payload)
  return { blobId, payload: { kind: 'text', text: c.text } }
}

async function buildFillBatch({ batchIndex, prevRoot, pdfSha256, planRoot, fills, knownBlobIds }) {
  const blobs = []
  const outFills = []
  const emitted = new Set()
  for (const f of fills) {
    const blob = await makeContentBlob(f.payload)
    outFills.push({
      slotId: f.slotId,
      blobId: blob.blobId,
      personSlotIndex: f.personSlotIndex,
    })
    if (!knownBlobIds.has(blob.blobId) && !emitted.has(blob.blobId)) {
      blobs.push(blob)
      emitted.add(blob.blobId)
    }
  }
  return {
    batchIndex,
    prevRoot: normalizeHex64(prevRoot),
    pdfSha256: normalizeHex64(pdfSha256),
    planRoot: normalizeHex64(planRoot),
    blobs,
    fills: outFills,
  }
}

function batchToWire(batch) {
  const wire = {
    v: 2,
    bi: batch.batchIndex | 0,
    pr: normalizeHex64(batch.prevRoot || ZERO_ROOT),
    pl: normalizeHex64(batch.planRoot),
  }
  if (batch.people?.length) {
    wire.people = [...batch.people]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map(p => ({ i: p.slotIndex, n: String(p.displayName ?? '').trim().slice(0, 80) }))
  }
  if (batch.places?.length) {
    wire.places = [...batch.places]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(s => ({
        id: s.id,
        p: s.personSlotIndex,
        k: kindToWire(s.kind),
        page: s.pageIndex | 0,
        x: q(clamp01(s.x)),
        y: q(clamp01(s.y)),
        w: q(Math.max(1e-9, clamp01(s.width))),
        h: q(Math.max(1e-9, clamp01(s.height))),
      }))
  }
  if (batch.blobs?.length) {
    wire.blobs = batch.blobs
      .slice()
      .sort((a, b) => a.blobId.localeCompare(b.blobId))
      .map(blob => {
        if (blob.payload.kind === 'ink') {
          return {
            id: normalizeHex32(blob.blobId),
            t: 'ink',
            d: {
              epsilon: q(blob.payload.path.epsilon, 2),
              lineWidthRatio: q(blob.payload.path.lineWidthRatio, 4),
              strokes: blob.payload.path.strokes.map(s => ({
                points: s.points.map(pt => ({ x: q(pt.x), y: q(pt.y) })),
              })),
            },
          }
        }
        return {
          id: normalizeHex32(blob.blobId),
          t: 'text',
          d: { text: String(blob.payload.text ?? '').slice(0, 500) },
        }
      })
  }
  if (batch.fills?.length) {
    wire.fills = batch.fills
      .slice()
      .sort((a, b) => a.slotId.localeCompare(b.slotId) || a.blobId.localeCompare(b.blobId))
      .map(f => ({ s: f.slotId, b: normalizeHex32(f.blobId), p: f.personSlotIndex }))
  }
  return wire
}

function wireJson(batch) {
  return JSON.stringify(batchToWire(batch))
}

async function computeBatchRoot(batch) {
  return sha256Hex(new TextEncoder().encode(wireJson(batch)))
}

function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function hexToBytes(hex) {
  const clean = normalizeHex64(hex)
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  return out
}

function packPlacementBatch(batch) {
  const hash = hexToBytes(batch.pdfSha256)
  const json = new TextEncoder().encode(wireJson(batch))
  const checksum = crc32(json)
  const dataChunks = []
  for (let off = 0; off < json.length; off += FRAME_BODY) {
    dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
  }
  if (!dataChunks.length) dataChunks.push(new Uint8Array(0))
  const total = 2 + dataChunks.length
  if (total > MAX_STREAM_FRAMES) throw new Error('too many frames')
  const frames = []
  let seq = 0
  const writeHeader = (frame, type, s, tot) => {
    frame[0] = STREAM_MAGIC
    frame[1] = STREAM_VERSION_V2
    frame[2] = type
    frame[3] = s & 0xff
    frame[4] = tot & 0xff
    frame[5] = hash[0]
    frame[6] = hash[1]
    frame[7] = hash[2]
    frame[8] = hash[3]
  }
  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_HEAD, seq++, total)
    f.set(hash, FRAME_HEADER)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER + 32, json.length, false)
    view.setUint16(FRAME_HEADER + 36, batch.batchIndex & 0xffff, false)
    view.setUint32(FRAME_HEADER + 38, checksum, false)
    frames.push(f)
  }
  for (const chunk of dataChunks) {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_DATA, seq++, total)
    f.set(chunk, FRAME_HEADER)
    frames.push(f)
  }
  {
    const f = new Uint8Array(FRAME_SIZE)
    writeHeader(f, FRAME_END, seq++, total)
    const view = new DataView(f.buffer)
    view.setUint32(FRAME_HEADER, json.length, false)
    view.setUint32(FRAME_HEADER + 4, checksum, false)
    frames.push(f)
  }
  return frames
}

async function unpackPlacementBatch(framesIn) {
  const frames = [...framesIn].sort((a, b) => a[3] - b[3])
  const head = frames[0]
  if (head[0] !== STREAM_MAGIC || head[1] !== STREAM_VERSION_V2 || head[2] !== FRAME_HEAD) {
    throw new Error('bad head')
  }
  const total = head[4]
  if (frames.length !== total) throw new Error('frame count')
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength)
  const payloadLen = view.getUint32(FRAME_HEADER + 32, false)
  const checksum = view.getUint32(FRAME_HEADER + 38, false)
  const parts = []
  for (let i = 1; i < frames.length; i++) {
    if (frames[i][2] === FRAME_DATA) parts.push(frames[i].subarray(FRAME_HEADER))
  }
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) {
    joined.set(p, off)
    off += p.length
  }
  const payload = joined.subarray(0, payloadLen)
  if (crc32(payload) !== checksum) throw new Error('crc')
  const wire = JSON.parse(new TextDecoder().decode(payload))
  const batchRoot = await sha256Hex(payload.slice())
  return { wire, batchRoot, frameCount: total }
}

async function mergePlacementBatches(batchesIn) {
  const batches = [...batchesIn].sort((a, b) => a.batchIndex - b.batchIndex)
  let prevRoot = ZERO_ROOT
  const blobs = new Map()
  const fills = new Map()
  let slots = []
  for (const batch of batches) {
    if (batch.prevRoot !== prevRoot) throw new Error('prevRoot mismatch')
    if (batch.places?.length) slots = batch.places
    for (const blob of batch.blobs ?? []) blobs.set(blob.blobId, blob.payload)
    for (const f of batch.fills ?? []) fills.set(f.slotId, f.blobId)
    prevRoot = batch.batchRoot ?? (await computeBatchRoot(batch))
  }
  return { slots, blobs, fills }
}

const PDF = 'a'.repeat(64)

async function main() {
  // plan root stability
  const plan = {
    pdfSha256: PDF,
    people: [
      { slotIndex: 1, displayName: 'Tom' },
      { slotIndex: 2, displayName: 'Alex' },
    ],
    slots: [
      {
        id: 'slot-sig-tom',
        personSlotIndex: 1,
        kind: 'signature',
        pageIndex: 0,
        x: 0.1,
        y: 0.7,
        width: 0.35,
        height: 0.08,
      },
      {
        id: 'slot-name-tom',
        personSlotIndex: 1,
        kind: 'name',
        pageIndex: 0,
        x: 0.1,
        y: 0.8,
        width: 0.35,
        height: 0.04,
      },
      {
        id: 'slot-sig-alex',
        personSlotIndex: 2,
        kind: 'signature',
        pageIndex: 0,
        x: 0.55,
        y: 0.7,
        width: 0.35,
        height: 0.08,
      },
    ],
  }

  const root1 = await computePlanRoot(plan)
  const root2 = await computePlanRoot(plan)
  assert(root1 === root2 && root1.length === 64, 'planRoot stable')
  const reordered = { ...plan, slots: [...plan.slots].reverse() }
  assert((await computePlanRoot(reordered)) === root1, 'planRoot independent of slot order')
  const asOrganizer = { ...plan, creatorSigningAs: null }
  const asPerson2 = { ...plan, creatorSigningAs: 2 }
  assert(
    (await computePlanRoot(asOrganizer)) !== (await computePlanRoot(asPerson2)),
    'planRoot differs for organizer-only vs signing as person 2',
  )
  assert(
    (await computePlanRoot(asOrganizer)) === (await computePlanRoot({ ...plan, creatorSigningAs: null })),
    'explicit null creatorSigningAs stable',
  )

  // plan batch 0
  const batch0 = {
    batchIndex: 0,
    prevRoot: ZERO_ROOT,
    pdfSha256: PDF,
    planRoot: root1,
    people: plan.people,
    places: plan.slots,
    blobs: [],
    fills: [],
  }
  const batch0Root = await computeBatchRoot(batch0)
  batch0.batchRoot = batch0Root
  const frames0 = packPlacementBatch(batch0)
  assert(frames0[0][1] === 2, 'stream version 2')
  assert(frames0.length >= 2, 'plan frames')
  const un0 = await unpackPlacementBatch(frames0)
  assert(un0.batchRoot === batch0Root, 'batchRoot matches after unpack')
  assert(un0.wire.places.length === 3, 'places on wire')

  // fill: same ink twice + name → 2 blobs not 3
  const inkPath = {
    epsilon: 1.5,
    lineWidthRatio: 0.02,
    strokes: [{ points: Array.from({ length: 12 }, (_, i) => ({ x: i / 11, y: 0.5 })) }],
  }
  const known = new Set()
  const fillBatch = await buildFillBatch({
    batchIndex: 1,
    prevRoot: batch0Root,
    pdfSha256: PDF,
    planRoot: root1,
    knownBlobIds: known,
    fills: [
      { slotId: 'slot-sig-tom', personSlotIndex: 1, payload: { kind: 'ink', path: inkPath } },
      { slotId: 'slot-sig-alex', personSlotIndex: 2, payload: { kind: 'ink', path: inkPath } },
      { slotId: 'slot-name-tom', personSlotIndex: 1, payload: { kind: 'text', text: 'Tom Smith' } },
    ],
  })
  assert(fillBatch.blobs.length === 2, 'dedup: 2 blobs (ink+text), not 3')
  assert(fillBatch.fills.length === 3, '3 fills')
  const inkBlob = fillBatch.blobs.find(b => b.payload.kind === 'ink')
  assert(inkBlob, 'ink blob present')
  assert(
    fillBatch.fills.filter(f => f.blobId === inkBlob.blobId).length === 2,
    'both sig fills share blob_id',
  )

  const fillRoot = await computeBatchRoot(fillBatch)
  fillBatch.batchRoot = fillRoot
  const frames1 = packPlacementBatch(fillBatch)
  const un1 = await unpackPlacementBatch(frames1)
  assert(un1.wire.blobs.length === 2, 'unpack fill blobs')
  assert(un1.wire.fills.length === 3, 'unpack fills')

  // known blob not re-emitted
  const known2 = new Set(fillBatch.blobs.map(b => b.blobId))
  const fill2 = await buildFillBatch({
    batchIndex: 2,
    prevRoot: fillRoot,
    pdfSha256: PDF,
    planRoot: root1,
    knownBlobIds: known2,
    fills: [
      { slotId: 'extra', personSlotIndex: 1, payload: { kind: 'ink', path: inkPath } },
    ],
  })
  assert(fill2.blobs.length === 0, 'known ink blob not re-emitted')
  assert(fill2.fills[0].blobId === inkBlob.blobId, 'fill points at known ink')

  // merge
  const merged = await mergePlacementBatches([batch0, fillBatch])
  assert(merged.slots.length === 3, 'merged slots')
  assert(merged.fills.size === 3, 'merged fills')
  assert(merged.blobs.size === 2, 'merged blob store size')

  // tamper
  let threw = false
  try {
    await mergePlacementBatches([
      batch0,
      { ...fillBatch, prevRoot: 'b'.repeat(64) },
    ])
  } catch {
    threw = true
  }
  assert(threw, 'tampered prevRoot rejected')

  assert(frames0.length <= 128 && frames1.length <= 128, 'under frame cap')

  // sanity: node createHash matches webcrypto for same string
  const sample = 'hello-placement'
  const web = await sha256Hex(new TextEncoder().encode(sample))
  const node = createHash('sha256').update(sample).digest('hex')
  assert(web === node, 'webcrypto matches node sha256')

  if (failed > 0) {
    console.error(`\n${failed} failure(s)`)
    process.exit(1)
  }
  console.log('\nAll placement stream tests passed.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
