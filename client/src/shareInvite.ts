import { formatPartyRole } from './signing'
import { documentTypeUsesNotes, type RentalMetadata, type SealDocument } from './types'
import { mimeForDocumentFile } from './pdf/documentKinds'

export interface ShareInviteContent {
  subject: string
  title: string
  shareUrl: string
  pdfName: string
  /** True when the invite is built as an .eml that already includes the document file. */
  pdfAttached: boolean
  signed: number
  required: number
  waitingOn: string[]
  rentalLines: string[]
  detailLines: string[]
  signingSteps: string[]
}

export interface ShareInviteOptions {
  /** When true, copy assumes the file is already attached (e.g. .eml package). */
  pdfAttached?: boolean
}

export interface BuildShareEmlOptions {
  /** Optional pre-filled To: recipients (validated emails). */
  recipients?: string[]
}

/** Result of handing an .eml package to the OS. */
export type EmlHandoffResult = 'shared' | 'downloaded'

/** Result of Web Share API invite with PDF. */
export type WebShareInviteResult = 'shared' | 'cancelled' | 'unsupported'

/** Loose but practical address check for compose pre-fill (not full RFC 5322). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  const pdfName = doc.originalFilename ?? 'the agreement file'

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

export interface ShareEmailBodyOptions extends ShareInviteOptions {
  /**
   * When set (mailto + separate PDF download), tell the signer to attach this
   * just-downloaded filename — Apple Mail cannot open mailto: with attachments.
   */
  pdfDownloadName?: string
}

export function buildShareEmailBody(
  doc: SealDocument,
  shareUrl: string,
  options: ShareEmailBodyOptions = {},
): string {
  const content = buildShareInviteContent(doc, shareUrl, options)
  const downloadName = options.pdfDownloadName?.trim()

  const pdfSection = content.pdfAttached
    ? [
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  AGREEMENT FILE (attached)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `This email includes the exact file to sign: ${content.pdfName}`,
        '',
        'VeriLock never hosts your file. Keep this attachment with the signing link so the co-signer can verify the fingerprint locally.',
      ]
    : downloadName
      ? [
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          '  ATTACH THE FILE (required)',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `Attach this exact file (just downloaded to your computer): ${downloadName}`,
          '',
          'In Apple Mail: drag the file into this message, or use the paperclip button.',
          'VeriLock never hosts your file. The signer must receive the same file you fingerprinted.',
        ]
      : [
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          '  ATTACH THE FILE (required)',
          '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          `Attach this exact file to your email: ${content.pdfName}`,
          '',
          'VeriLock never hosts your file. The signer must receive the same file you fingerprinted so they can verify it locally.',
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

/**
 * Shorter body for the OS share sheet (Web Share API).
 * Full email body is long for Messages / some targets; link + PDF attachment carry the load.
 */
export function buildShareSheetText(
  doc: SealDocument,
  shareUrl: string,
  options: ShareInviteOptions = {},
): string {
  const content = buildShareInviteContent(doc, shareUrl, options)
  const pdfLine = content.pdfAttached
    ? `The agreement file (${content.pdfName}) is attached — use that exact file when you sign.`
    : `You'll need the agreement file (${content.pdfName}) to verify the fingerprint.`

  return [
    `Please sign "${content.title}" on VeriLock.`,
    '',
    content.shareUrl,
    '',
    pdfLine,
    '',
    'How to sign:',
    ...content.signingSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'VeriLock never hosts the file — it only travels with this share.',
  ].join('\n')
}

export function buildShareMailtoUrl(
  doc: SealDocument,
  shareUrl: string,
  recipients: string[] = [],
  options: ShareEmailBodyOptions = {},
): string {
  const content = buildShareInviteContent(doc, shareUrl, options)
  const body = buildShareEmailBody(doc, shareUrl, options)
  // Validated emails only — leave @ and commas unencoded for mail clients.
  const to = recipients.map(e => e.trim()).filter(Boolean).join(',')
  return `mailto:${to}?subject=${encodeURIComponent(content.subject)}&body=${encodeURIComponent(body)}`
}

/** Dedupe emails (case-insensitive) while preserving first-seen order. */
export function mergeRecipientLists(...lists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    if (!list) continue
    for (const raw of list) {
      const email = raw.trim()
      if (!email) continue
      const key = email.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(email)
    }
  }
  return out
}

/** Open the default mail client compose window (mailto). */
export function openMailtoCompose(mailtoUrl: string): void {
  const anchor = document.createElement('a')
  anchor.href = mailtoUrl
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * Pull a bare address from free text (`alice@x.com` or `Alice <alice@x.com>`).
 */
function extractEmailToken(part: string): string {
  const trimmed = part.trim()
  if (!trimmed) return ''
  const angle = trimmed.match(/<([^<>@\s]+@[^<>@\s]+)>/)
  if (angle?.[1]) return angle[1].trim()
  return trimmed
}

/**
 * Split a free-text recipient field into emails (comma / semicolon / whitespace).
 * Also accepts `Name <email@domain>` tokens.
 * Returns unique addresses in entry order.
 */
export function parseRecipientEmails(raw: string): string[] {
  // Split on commas/semicolons first so "Alice <a@x.com>, Bob <b@y.com>" works.
  const chunks = raw
    .split(/[,;]+/)
    .map(chunk => chunk.trim())
    .filter(Boolean)

  const parts: string[] = []
  for (const chunk of chunks) {
    const extracted = extractEmailToken(chunk)
    if (extracted.includes('@')) {
      parts.push(extracted)
      continue
    }
    // Fallback: whitespace-separated bare emails
    for (const word of chunk.split(/\s+/)) {
      const email = extractEmailToken(word)
      if (email) parts.push(email)
    }
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out
}

/** Returns invalid tokens (empty string input → no invalids). */
export function invalidRecipientEmails(raw: string): string[] {
  if (!raw.trim()) return []
  return parseRecipientEmails(raw).filter(email => !EMAIL_RE.test(email))
}

export function isValidEmailAddress(email: string): boolean {
  return EMAIL_RE.test(email.trim())
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

function formatToHeader(recipients: string[]): string {
  const cleaned = recipients.map(e => e.trim()).filter(Boolean)
  if (cleaned.length === 0) return 'To: '
  // Angle-bracket form is the most widely accepted by Apple Mail / Outlook drafts.
  const formatted = cleaned.map(email =>
    email.includes('<') ? email : `<${email}>`,
  )
  return `To: ${formatted.join(', ')}`
}

function rfc2822Date(date = new Date()): string {
  return date.toUTCString().replace(/GMT$/, '+0000')
}

/**
 * Build a multipart .eml the user can open in their mail app as a **compose draft**.
 * PDF bytes stay on-device; VeriLock never receives the file.
 *
 * Important headers:
 * - `X-Unsent: 1` — Outlook opens as editable draft
 * - `X-Uniform-Type-Identifier: com.apple.mail-draft` — Apple Mail draft hint
 * - `To:` — pre-filled when recipients are known
 *
 * Note: Apple Mail often ignores To: on imported .eml drafts. Prefer mailto compose
 * for reliable To pre-fill on macOS (see ShareInviteCard “Open in Mail”).
 */
export async function buildShareEmlBlob(
  doc: SealDocument,
  shareUrl: string,
  pdfFile: File,
  options: BuildShareEmlOptions = {},
): Promise<Blob> {
  const content = buildShareInviteContent(doc, shareUrl, { pdfAttached: true })
  const body = buildShareEmailBody(doc, shareUrl, { pdfAttached: true })
  const pdfName = pdfFile.name || content.pdfName || 'agreement.pdf'
  const pdfBytes = new Uint8Array(await pdfFile.arrayBuffer())
  const fileMime = mimeForDocumentFile(pdfFile)
  const boundary = `----=_VeriLock_${crypto.randomUUID().replace(/-/g, '')}`
  const recipients = options.recipients ?? []
  const messageId = `<verilock-invite-${crypto.randomUUID()}@local>`

  const headers = [
    // Standard headers first (closer to real Mail drafts)
    'MIME-Version: 1.0',
    `Date: ${rfc2822Date()}`,
    `Message-ID: ${messageId}`,
    formatToHeader(recipients),
    `Subject: ${encodeRfc2047Subject(content.subject)}`,
    // Draft / unsent — open in compose mode, not as a sealed inbox message
    'X-Unsent: 1',
    // Apple Mail: open as editable draft (alongside X-Unsent for Outlook)
    'X-Uniform-Type-Identifier: com.apple.mail-draft',
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
    `Content-Type: ${fileMime}; name="${pdfName.replace(/["\\]/g, '_')}"`,
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

function isUserShareCancel(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = 'name' in err ? String((err as { name?: unknown }).name) : ''
  // AbortError is standard; some WebKit builds use NotAllowedError after dismiss.
  return name === 'AbortError'
}

/**
 * Desktop Safari on macOS reports canShare({ files }) but many targets (especially
 * Messages) open with an empty compose — no text, no PDF. Treat as unsupported so
 * the UI does not offer “Share file + invite” there. iOS/iPadOS keep file share.
 */
export function isDesktopMacWebShareUnreliable(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
): boolean {
  if (typeof nav === 'undefined' || !nav.userAgent) return false
  const ua = nav.userAgent
  const isIpad =
    /iPad/i.test(ua) ||
    (nav.platform === 'MacIntel' && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 1)
  if (/iPhone|iPod/i.test(ua) || isIpad) return false
  return /Mac/i.test(nav.platform) || /Macintosh/i.test(ua)
}

/** True when the browser can share the given files via the OS share sheet. */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined') return false
  if (typeof navigator.share !== 'function') return false
  if (files.length === 0) return false
  // macOS desktop: share sheet targets (Messages) often receive empty payload.
  if (isDesktopMacWebShareUnreliable()) return false
  if (typeof navigator.canShare !== 'function') {
    // Older Safari: share exists but canShare may be missing — try files optimistically
    // only when we know Level 2 is common; without canShare, avoid claiming support.
    return false
  }
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

/**
 * Share the local document file + short invite text via the OS share sheet.
 * Bytes never leave the device for VeriLock — only the app the user picks receives them.
 */
export async function shareInviteWithPdf(
  doc: SealDocument,
  shareUrl: string,
  pdfFile: File,
): Promise<WebShareInviteResult> {
  // Hard-block desktop Mac even if a caller bypasses canShareFiles.
  if (isDesktopMacWebShareUnreliable()) return 'unsupported'

  const pdfName = pdfFile.name || doc.originalFilename || 'agreement.pdf'
  // Always materialize a named File with explicit MIME — some share targets ignore
  // File/Blob objects without an explicit type or with empty names.
  const file = new File([pdfFile], pdfName, {
    type: mimeForDocumentFile(pdfFile),
    lastModified: pdfFile.lastModified || Date.now(),
  })

  if (!canShareFiles([file])) return 'unsupported'

  const content = buildShareInviteContent(doc, shareUrl, { pdfAttached: true })
  const text = buildShareSheetText(doc, shareUrl, { pdfAttached: true })

  // Prefer files + text + url (mobile Safari/Chrome). Fall back in stages.
  const attempts: ShareData[] = [
    { title: content.subject, text, url: shareUrl, files: [file] },
    { title: content.subject, text, files: [file] },
    { title: content.subject, files: [file] },
    // Last resort: link only — better empty failure on mobile than silent miss.
    { title: content.subject, text, url: shareUrl },
  ]

  for (const data of attempts) {
    try {
      if (typeof navigator.canShare === 'function') {
        try {
          if (!navigator.canShare(data)) continue
        } catch {
          continue
        }
      }
      await navigator.share(data)
      return 'shared'
    } catch (err) {
      if (isUserShareCancel(err)) return 'cancelled'
      // Try next payload shape.
    }
  }
  return 'unsupported'
}

/**
 * Hand an .eml draft to the OS: prefer sharing the file (opens Mail on many devices),
 * otherwise download so the user can open it from the download bar / folder.
 *
 * User cancel of the share sheet is rethrown as AbortError so callers can stay silent.
 */
export async function handoffShareEml(
  blob: Blob,
  filename: string,
): Promise<EmlHandoffResult> {
  const file = new File([blob], filename, { type: 'message/rfc822' })

  if (canShareFiles([file])) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
      })
      return 'shared'
    } catch (err) {
      if (isUserShareCancel(err)) throw err
      // Fall through to download when share fails for other reasons.
    }
  }

  downloadBlob(blob, filename)
  return 'downloaded'
}
