import { formatPartyRole } from './signing'
import type { RentalMetadata, SealDocument } from './types'

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

export function buildShareEmailBody(doc: SealDocument, shareUrl: string): string {
  const waitingOn = pendingPartyLabels(doc)
  const rentalLines = doc.type === 'rental' ? rentalDetailLines(doc.metadata as RentalMetadata) : []
  const pdfName = doc.originalFilename ?? 'the agreement PDF'

  const lines = [
    'Hi,',
    '',
    `You're invited to sign "${doc.title}" on VeriLock.`,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  SIGNING LINK',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    shareUrl,
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '  ATTACH THE PDF (required)',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Attach this exact file to your email: ${pdfName}`,
    '',
    'VeriLock never hosts your PDF. The signer must receive the same file you fingerprinted so they can verify it locally.',
    '',
    'How to sign:',
    '1. Open the signing link above in your browser',
    '2. Connect a Nimiq wallet',
    `3. Choose ${pdfName} on your computer and confirm it matches`,
    '4. Enter your name, draw your signature, and submit',
    '',
    'Agreement details:',
    `• Title: ${doc.title}`,
    `• Signatures: ${doc.signingProgress.signed}/${doc.signingProgress.required} collected`,
    ...rentalLines.map(line => `• ${line}`),
    ...(waitingOn.length > 0 ? [`• Still waiting on: ${waitingOn.join(', ')}`] : []),
    '',
    '—',
    'VeriLock · Sign together. Prove forever.',
  ]

  return lines.join('\n')
}

export function buildShareMailtoUrl(doc: SealDocument, shareUrl: string): string {
  const subject = `Please sign: ${doc.title}`
  const body = buildShareEmailBody(doc, shareUrl)
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}