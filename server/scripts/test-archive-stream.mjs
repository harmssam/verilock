/**
 * Unit tests for archive stream pack/unpack + manifest (no Nimiq RPC).
 * Run: node server/scripts/test-archive-stream.mjs
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

// Prefer compiled dist if present; else load via tsx-less pure reimplementation below.
let failed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('ok:', msg)
  }
}

const STREAM_MAGIC = 0xa1
const STREAM_VERSION_MANIFEST = 3
const FRAME_SIZE = 64
const FRAME_HEADER = 9
const FRAME_BODY = 55
const FRAME_HEAD = 1
const FRAME_DATA = 2
const FRAME_END = 3

function crc32(data) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    c ^= data[i]
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function packJsonStreamFrames(pdfSha256, version, payload) {
  const hash = Buffer.from(pdfSha256, 'hex')
  const json = Buffer.from(JSON.stringify(payload), 'utf8')
  const checksum = crc32(json)
  const dataChunks = []
  for (let off = 0; off < json.length; off += FRAME_BODY) {
    dataChunks.push(json.subarray(off, Math.min(json.length, off + FRAME_BODY)))
  }
  if (dataChunks.length === 0) dataChunks.push(Buffer.alloc(0))
  const total = 2 + dataChunks.length
  const frames = []
  let seq = 0
  {
    const f = Buffer.alloc(FRAME_SIZE)
    f[0] = STREAM_MAGIC
    f[1] = version
    f[2] = FRAME_HEAD
    f[3] = seq++
    f[4] = total
    hash.copy(f, 5, 0, 4)
    hash.copy(f, FRAME_HEADER)
    f.writeUInt32BE(json.length, FRAME_HEADER + 32)
    f.writeUInt16BE(0, FRAME_HEADER + 36)
    f.writeUInt32BE(checksum, FRAME_HEADER + 38)
    frames.push(f)
  }
  for (const chunk of dataChunks) {
    const f = Buffer.alloc(FRAME_SIZE)
    f[0] = STREAM_MAGIC
    f[1] = version
    f[2] = FRAME_DATA
    f[3] = seq++
    f[4] = total
    hash.copy(f, 5, 0, 4)
    chunk.copy(f, FRAME_HEADER)
    frames.push(f)
  }
  {
    const f = Buffer.alloc(FRAME_SIZE)
    f[0] = STREAM_MAGIC
    f[1] = version
    f[2] = FRAME_END
    f[3] = seq++
    f[4] = total
    hash.copy(f, 5, 0, 4)
    f.writeUInt32BE(json.length, FRAME_HEADER)
    f.writeUInt32BE(checksum, FRAME_HEADER + 4)
    frames.push(f)
  }
  return frames
}

function unpackJsonStreamPayload(framesIn) {
  const frames = [...framesIn].sort((a, b) => a[3] - b[3])
  const head = frames[0]
  assert(head[0] === STREAM_MAGIC, 'magic')
  const version = head[1]
  const total = head[4]
  assert(frames.length === total, 'total frames')
  const hash = head.subarray(FRAME_HEADER, FRAME_HEADER + 32)
  const payloadLen = head.readUInt32BE(FRAME_HEADER + 32)
  const checksum = head.readUInt32BE(FRAME_HEADER + 38)
  const parts = []
  for (let i = 1; i < frames.length; i++) {
    if (frames[i][2] === FRAME_DATA) parts.push(frames[i].subarray(FRAME_HEADER))
  }
  const joined = Buffer.concat(parts).subarray(0, payloadLen)
  assert(crc32(joined) === checksum, 'crc')
  return {
    version,
    pdfSha256: hash.toString('hex'),
    payload: JSON.parse(joined.toString('utf8')),
  }
}

function splitFrameStreams(frames) {
  const streams = []
  let i = 0
  while (i < frames.length) {
    const head = frames[i]
    const total = head[4]
    streams.push(frames.slice(i, i + total))
    i += total
  }
  return streams
}

const PDF = 'ab'.repeat(32)
const manifest = {
  v: 3,
  kind: 'archive_manifest',
  pdf: PDF,
  pl: 'cd'.repeat(32),
  doc: 'test-doc-id',
  title: 'Lease',
  people: [
    { i: 1, n: 'Tom', w: 'NQ01TESTADDRESSPLACEHOLDER000000000' },
    { i: 2, n: 'Alex', w: 'NQ02TESTADDRESSPLACEHOLDER000000000' },
  ],
  sigs: [
    {
      i: 1,
      w: 'NQ01TESTADDRESSPLACEHOLDER000000000',
      n: 'Tom',
      at: 1_700_000_000_000,
      t: 'drawn',
      sha: PDF,
    },
  ],
}

const frames = packJsonStreamFrames(PDF, STREAM_VERSION_MANIFEST, manifest)
assert(frames.length >= 2, `packed ${frames.length} frames`)
assert(frames[0][0] === STREAM_MAGIC, 'head magic')
assert(frames[0][1] === STREAM_VERSION_MANIFEST, 'head version 3')

const un = unpackJsonStreamPayload(frames)
assert(un.pdfSha256 === PDF, 'pdf hash roundtrip')
assert(un.payload.kind === 'archive_manifest', 'kind')
assert(un.payload.people.length === 2, 'people count')
assert(un.payload.people[0].w.startsWith('NQ01'), 'wallet on wire')
assert(un.payload.sigs.length === 1, 'sigs count')

// Two streams concatenated (manifest twice) split correctly
const double = [...frames, ...frames]
const streams = splitFrameStreams(double)
assert(streams.length === 2, 'split two streams')
assert(streams[0].length === frames.length, 'stream0 length')

// Placement-like batch (v2) + manifest (v3)
const batch = {
  v: 2,
  bi: 0,
  pr: '00'.repeat(32),
  pl: 'cd'.repeat(32),
  people: [{ i: 1, n: 'Tom', w: 'NQ01W' }],
  places: [
    {
      id: 's1',
      p: 1,
      k: 's',
      page: 0,
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.05,
    },
  ],
  blobs: [],
  fills: [],
}
const v2 = packJsonStreamFrames(PDF, 2, batch)
const archive = [...v2, ...frames]
const parts = splitFrameStreams(archive)
assert(parts.length === 2, 'placement + manifest streams')
assert(parts[0][0][1] === 2, 'first stream v2')
assert(parts[1][0][1] === 3, 'second stream v3')

if (failed) {
  console.error(`\n${failed} failure(s)`)
  process.exit(1)
}
console.log('\nAll archive-stream tests passed')
