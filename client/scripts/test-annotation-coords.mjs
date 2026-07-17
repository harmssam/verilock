/**
 * Pure coordinate transform tests (no browser / no pdf-lib).
 * Run: node scripts/test-annotation-coords.mjs  (from client/)
 */

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function canvasRectToNormalized(rect, canvasWidth, canvasHeight, pageIndex) {
  const w = Math.max(1e-9, canvasWidth)
  const h = Math.max(1e-9, canvasHeight)
  return {
    pageIndex,
    x: clamp01(rect.left / w),
    y: clamp01(rect.top / h),
    width: clamp01(rect.width / w),
    height: clamp01(rect.height / h),
  }
}

function normalizedToCanvasRect(geo, canvasWidth, canvasHeight) {
  return {
    left: geo.x * canvasWidth,
    top: geo.y * canvasHeight,
    width: geo.width * canvasWidth,
    height: geo.height * canvasHeight,
  }
}

let failed = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    failed++
  } else {
    console.log('ok:', msg)
  }
}

const W = 612
const H = 792

// Place something in each corner (CSS top-left origin)
const corners = [
  { name: 'top-left', left: 10, top: 10, width: 100, height: 40 },
  { name: 'top-right', left: W - 110, top: 10, width: 100, height: 40 },
  { name: 'bottom-left', left: 10, top: H - 50, width: 100, height: 40 },
  { name: 'bottom-right', left: W - 110, top: H - 50, width: 100, height: 40 },
]

for (const c of corners) {
  const norm = canvasRectToNormalized(c, W, H, 0)
  const back = normalizedToCanvasRect(norm, W, H)
  assert(Math.abs(back.left - c.left) < 1e-6, `${c.name} left round-trip`)
  assert(Math.abs(back.top - c.top) < 1e-6, `${c.name} top round-trip`)
  assert(Math.abs(back.width - c.width) < 1e-6, `${c.name} width round-trip`)
  assert(Math.abs(back.height - c.height) < 1e-6, `${c.name} height round-trip`)
}

// Scale independence: place at bottom-right on 612×792, reconstruct at 2× zoom
const place = { left: 500, top: 720, width: 90, height: 36 }
const geo = canvasRectToNormalized(place, W, H, 0)
const zoomW = W * 2
const zoomH = H * 2
const reconstructed = normalizedToCanvasRect(geo, zoomW, zoomH)
assert(Math.abs(reconstructed.left - place.left * 2) < 1e-6, 'scale-independent left')
assert(Math.abs(reconstructed.top - place.top * 2) < 1e-6, 'scale-independent top')

// Page 1 bottom-right + page 2 top-left scenario
const page1Sig = canvasRectToNormalized(
  { left: W * 0.7, top: H * 0.85, width: W * 0.22, height: H * 0.08 },
  W,
  H,
  0,
)
const page2Text = canvasRectToNormalized(
  { left: W * 0.05, top: H * 0.05, width: W * 0.3, height: H * 0.06 },
  W,
  H,
  1,
)
assert(
  page1Sig.pageIndex === 0 &&
    Math.abs(page1Sig.x - 0.7) < 1e-9 &&
    Math.abs(page1Sig.y - 0.85) < 1e-9,
  'p1 bottom-right geo',
)
assert(
  page2Text.pageIndex === 1 &&
    Math.abs(page2Text.x - 0.05) < 1e-9 &&
    Math.abs(page2Text.y - 0.05) < 1e-9,
  'p2 top-left geo',
)

// POST body must not carry PDF bytes
function bodyContainsPdfBytes(body) {
  if (!body || typeof body !== 'object') return false
  const keys = ['pdf', 'pdfBytes', 'file', 'fileBytes', 'documentBytes', 'content', 'data']
  for (const k of keys) {
    const v = body[k]
    if (typeof v === 'string' && v.length > 200 && (/^JVBER/i.test(v) || v.includes('%PDF'))) {
      return true
    }
  }
  return false
}

const goodBody = {
  title: 'Test',
  originalSha256: 'a'.repeat(64),
  pageCount: 2,
  annotations: [page1Sig, page2Text],
}
assert(!bodyContainsPdfBytes(goodBody), 'good POST has no PDF bytes')
assert(
  bodyContainsPdfBytes({ ...goodBody, pdf: '%PDF-1.4' + 'x'.repeat(300) }),
  'detects PDF bytes field',
)

console.log(failed === 0 ? '\nAll coordinate tests passed.' : `\n${failed} test(s) failed.`)
process.exit(failed === 0 ? 0 : 1)
