import { formatPartyRole } from './signing'
import { documentTypeUsesNotes, type RentalMetadata, type SealDocument } from './types'

export interface ShareInviteContent {
  subject: string
  title: string
  shareUrl: string
  pdfName: string
  /** True when the invite is built as an .eml that already includes the PDF. */
  pdfAttached: boolean
  signed: number
  required: number
  waitingOn: string[]
  rentalLines: string[]
  detailLines: string[]
  signingSteps: string[]
}

export interface ShareInviteOptions {
  /** When true, copy assumes the PDF is already attached (e.g. .eml package). */
  pdfAttached?: boolean
}

function pendingPartyLabels(doc: SealDocument): string[] {
  return doc.parties
    .filter(party => party.required && party.status !== 'signed')
    .map(party => {
      const role = formatPartyRole(party.role)
      return party.displayName ? `${party.displayName} (${role})` : role
    })
}

function rentalDetailLines(metadata: RentalMetadata | null): string[] {
  if (!metadata) return []
  const lines: string[] = []
  if (metadata.propertyAddress) lines.push(`Property: ${metadata.propertyAddress}`)
  const terms = [
    metadata.monthlyRent && `Rent: ${metadata.monthlyRent}`,
    metadata.deposit && `Deposit: ${metadata.deposit}`,
    metadata.startDate && `From: ${metadata.startDate}`,
    metadata.endDate && `To: ${metadata.endDate}`,
  ].filter(Boolean)
  if (terms.length > 0) lines.push(terms.join(' · '))
  return lines
}

function noteDetailLines(doc: SealDocument): string[] {
  if (!documentTypeUsesNotes(doc.type) || !doc.metadata) return []
  const notes = doc.metadata.notes
  if (typeof notes !== 'string' || !notes.trim()) return []
  return [`Notes: ${notes.trim()}`]
}

export function buildShareInviteContent(
  doc: SealDocument,
  shareUrl: string,
  options: ShareInviteOptions = {},
): ShareInviteContent {
  const pdfAttached = Boolean(options.pdfAttached)
  const waitingOn = pendingPartyLabels(doc)
  const rentalLines = doc.type === 'rental' ? rentalDetailLines(doc.metadata as RentalMetadata) : []
  const detailLines = [...rentalLines, ...noteDetailLines(doc)]
  const pdfName = doc.originalFilename ?? 'the agreement PDF'

  return {
    subject: `Please sign: ${doc.title}`,
    title: doc.title,
    shareUrl,
    pdfName,
    pdfAttached,
    signed: doc.signingProgress.signed,
    required: doc.signingProgress.required,
    waitingOn,
    rentalLines,
    detailLines,
    signingSteps: [
      'Open the signing link in your browser',
      'Connect a Nimiq wallet',
      pdfAttached
        ? `Choose the attached file (${pdfName}) and confirm it matches`
        : `Choose ${pdfName} on your computer and confirm it matches`,
      'Enter your name, draw your signature, and submit',
    ],
  }
}

export function buildShareEmailBody(
  doc: SealDocument,
  shareUrl: string,
  options: ShareInviteOptions = {},
): string {
  const content = buildShareInviteContent(doc, shareUrl, options)

  const pdfSection = content.pdfAttached
    ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  AGREEMENT PDF (attached)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `This email includes the exact file to sign: ${content.pdfName}`,
        '',
        'VeriLock never hosts your PDF. Keep this attachment with the signing link so the co-signer can verify the fingerprint locally.',
      ]
    : [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  ATTACH THE PDF (required)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `Attach this exact file to your email: ${content.pdfName}`,
        '',
        'VeriLock never hosts your PDF. The signer must receive the same file you fingerprinted so they can verify it locally.',
      ]

  const lines = [
    'Hi,',
    '',
    `You're invited to sign "${content.title}" on VeriLock.`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  SIGNING LINK',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    content.shareUrl,
    '',
    ...pdfSection,
    '',
    'How to sign:',
    ...content.signingSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Agreement details:',
    `• Title: ${content.title}`,
    `• Signatures: ${content.required === 0 ? 'none required (direct seal)' : `${content.signed}/${content.required} collected`}`,
    ...content.detailLines.map(line => `• ${line}`),
    ...(content.waitingOn.length > 0 ? [`• Still waiting on: ${content.waitingOn.join(', ')}`] : []),
    '',
    '—',
    'VeriLock · Sign together. Prove forever.',
  ]

  return lines.join('\n')
}

export function buildShareMailtoUrl(doc: SealDocument, shareUrl: string): string {
  const content = buildShareInviteContent(doc, shareUrl)
  const body = buildShareEmailBody(doc, shareUrl)
  return `mailto:?subject=${encodeURIComponent(content.subject)}&body=${encodeURIComponent(body)}`
}

/** CRLF for MIME / .eml wire format. */
const CRLF = '\r\n'

function encodeRfc2047Subject(text: string): string {
  if (/^[\x20-\x7E]*$/.test(text)) return text
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return `=?UTF-8?B?${btoa(binary)}?=`
}

/** ASCII-safe Content-Disposition filename, with RFC 5987 filename* for the real name. */
function contentDispositionAttachment(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'agreement.pdf'
  const encoded = encodeURIComponent(filename).replace(/['()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

function foldBase64(b64: string): string {
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76))
  }
  return lines.join(CRLF)
}

function sanitizeEmlBasename(title: string): string {
  const cleaned = title
    .trim()
    .replace(/[^\w\s.-]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return cleaned || 'agreement'
}

export function shareEmlDownloadName(doc: SealDocument): string {
  const base = sanitizeEmlBasename(doc.title || doc.originalFilename || 'agreement')
  return `verilock-invite-${base}.eml`
}

/**
 * Build a multipart .eml the user can open in their mail app as a **compose draft**.
 * PDF bytes stay on-device; VeriLock never receives the file.
 *
 * Important headers:
 * - `X-Unsent: 1` — Outlook / Apple Mail / Thunderbird open as editable draft
 *   (without this, many clients open the file as a received message → To is locked
 *   and users must Forward to add an address).
 * - Empty `To:` — compose field is present and blank for the user to fill.
 */
export async function buildShareEmlBlob(
  doc: SealDocument,
  shareUrl: string,
  pdfFile: File,
): Promise<Blob> {
  const content = buildShareInviteContent(doc, shareUrl, { pdfAttached: true })
  const body = buildShareEmailBody(doc, shareUrl, { pdfAttached: true })
  const pdfName = pdfFile.name || content.pdfName || 'agreement.pdf'
  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer())
  const boundary = `----=_VeriLock_${crypto.randomUUID().replace(/-/g, '')}`

  const headers = [
    // Draft / unsent — open in compose mode, not as a sealed inbox message
    'X-Unsent: 1',
    'To: ',
    `Subject: ${encodeRfc2047Subject(content.subject)}`,
    'MIME-Version: 1.0',
    'X-Mailer: VeriLock',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ]

  const textPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    // Normalize body newlines to CRLF for mail clients
    body.replace(/\r\n/g, '\n').replace(/\n/g, CRLF),
  ].join(CRLF)

  const pdfPart = [
    `--${boundary}`,
    `Content-Type: application/pdf; name="${pdfName.replace(/["\\]/g, '_')}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: ${contentDispositionAttachment(pdfName)}`,
    '',
    foldBase64(uint8ToBase64(pdfBytes)),
  ].join(CRLF)

  const closing = `--${boundary}--${CRLF}`

  const eml = [headers.join(CRLF), '', textPart, '', pdfPart, '', closing].join(CRLF)
  return new Blob([eml], { type: 'message/rfc822' })
}

/** Trigger a browser download for a blob (used for .eml invite packages). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Delay revoke so Safari can start the download
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000)
}
