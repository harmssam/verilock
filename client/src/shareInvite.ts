import { formatPartyRole } from './signing'
import { documentTypeUsesNotes, type RentalMetadata, type SealDocument } from './types'

export interface ShareInviteContent {
  subject: string
  title: string
  shareUrl: string
  pdfName: string
  signed: number
  required: number
  waitingOn: string[]
  rentalLines: string[]
  detailLines: string[]
  signingSteps: string[]
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

export function buildShareInviteContent(doc: SealDocument, shareUrl: string): ShareInviteContent {
  const waitingOn = pendingPartyLabels(doc)
  const rentalLines = doc.type === 'rental' ? rentalDetailLines(doc.metadata as RentalMetadata) : []
  const detailLines = [...rentalLines, ...noteDetailLines(doc)]
  const pdfName = doc.originalFilename ?? 'the agreement PDF'

  return {
    subject: `Please sign: ${doc.title}`,
    title: doc.title,
    shareUrl,
    pdfName,
    signed: doc.signingProgress.signed,
    required: doc.signingProgress.required,
    waitingOn,
    rentalLines,
    detailLines,
    signingSteps: [
      'Open the signing link in your browser',
      'Connect a Nimiq wallet',
      `Choose ${pdfName} on your computer and confirm it matches`,
      'Enter your name, draw your signature, and submit',
    ],
  }
}

export function buildShareEmailBody(doc: SealDocument, shareUrl: string): string {
  const content = buildShareInviteContent(doc, shareUrl)

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
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  ATTACH THE PDF (required)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Attach this exact file to your email: ${content.pdfName}`,
    '',
    'VeriLock never hosts your PDF. The signer must receive the same file you fingerprinted so they can verify it locally.',
    '',
    'How to sign:',
    ...content.signingSteps.map((step, index) => `${index + 1}. ${step}`),
    '',
    'Agreement details:',
    `• Title: ${content.title}`,
    `• Signatures: ${content.signed}/${content.required} collected`,
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