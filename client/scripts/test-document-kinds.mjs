/**
 * Unit checks for document kind detection (PDF + images).
 * Run: node scripts/test-document-kinds.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const kindsPath = join(clientDir, 'src/pdf/documentKinds.ts')
const src = readFileSync(kindsPath, 'utf8')

function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (e) {
    console.error(`  FAIL ${name}`)
    console.error(`       ${e.message}`)
    process.exitCode = 1
  }
}

console.log('test-document-kinds')

check('DOCUMENT_ACCEPT includes pdf and images', () => {
  assert.match(src, /export const DOCUMENT_ACCEPT/)
  assert.match(src, /application\/pdf/)
  assert.match(src, /image\/png/)
  assert.match(src, /image\/jpeg/)
  assert.match(src, /image\/webp/)
  assert.match(src, /\.png/)
  assert.match(src, /\.jpg/)
  assert.match(src, /\.webp/)
})

check('detectDocumentKind and isSupportedDocumentFile exported', () => {
  assert.match(src, /export function detectDocumentKind/)
  assert.match(src, /export function isSupportedDocumentFile/)
  assert.match(src, /export function mimeForDocumentFile/)
  assert.match(src, /export function stripDocumentExtension/)
})

check('supported image extensions listed', () => {
  assert.match(src, /\.png/)
  assert.match(src, /\.jpeg/)
  assert.match(src, /image\/webp/)
})

// Runtime logic mirror (keep in sync with documentKinds.ts)
const PDF_EXTS = ['.pdf']
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp']
const PDF_MIMES = new Set(['application/pdf', 'application/x-pdf'])
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp'])

function extensionOf(name) {
  const lower = name.toLowerCase()
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return ''
  return lower.slice(dot)
}

function detectDocumentKind(file) {
  const ext = extensionOf(file.name)
  const type = (file.type || '').toLowerCase().trim()
  if (PDF_EXTS.includes(ext) || PDF_MIMES.has(type)) return 'pdf'
  if (IMAGE_EXTS.includes(ext) || IMAGE_MIMES.has(type)) return 'image'
  return null
}

function stripDocumentExtension(filename) {
  return filename.replace(/\.(pdf|png|jpe?g|webp)$/i, '')
}

function mimeForDocumentFile(file) {
  const type = (file.type || '').toLowerCase().trim()
  if (type && type !== 'application/octet-stream') return type
  const ext = extensionOf(file.name)
  switch (ext) {
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    default:
      return type || 'application/octet-stream'
  }
}

check('detects pdf by extension and mime', () => {
  assert.equal(detectDocumentKind({ name: 'a.pdf', type: '' }), 'pdf')
  assert.equal(detectDocumentKind({ name: 'a.bin', type: 'application/pdf' }), 'pdf')
})

check('detects images by extension and mime', () => {
  assert.equal(detectDocumentKind({ name: 'a.png', type: '' }), 'image')
  assert.equal(detectDocumentKind({ name: 'a.JPG', type: '' }), 'image')
  assert.equal(detectDocumentKind({ name: 'a.webp', type: '' }), 'image')
  assert.equal(detectDocumentKind({ name: 'a.bin', type: 'image/jpeg' }), 'image')
})

check('rejects unsupported kinds', () => {
  assert.equal(detectDocumentKind({ name: 'a.gif', type: 'image/gif' }), null)
  assert.equal(detectDocumentKind({ name: 'a.heic', type: '' }), null)
  assert.equal(detectDocumentKind({ name: 'a.docx', type: '' }), null)
})

check('stripDocumentExtension', () => {
  assert.equal(stripDocumentExtension('contract.PDF'), 'contract')
  assert.equal(stripDocumentExtension('photo.jpeg'), 'photo')
  assert.equal(stripDocumentExtension('scan.webp'), 'scan')
})

check('mimeForDocumentFile from extension when type empty', () => {
  assert.equal(mimeForDocumentFile({ name: 'x.png', type: '' }), 'image/png')
  assert.equal(mimeForDocumentFile({ name: 'x.jpg', type: '' }), 'image/jpeg')
  assert.equal(mimeForDocumentFile({ name: 'x.pdf', type: '' }), 'application/pdf')
})

if (!process.exitCode) {
  console.log('all passed')
}
