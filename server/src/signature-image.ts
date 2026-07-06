import { createHash } from 'node:crypto'

/** Max stored PNG size (256 KiB) — line-art signatures compress well below this. */
export const MAX_SIGNATURE_IMAGE_BYTES = 256 * 1024

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function parseSignatureImageBase64(input: string): Buffer {
  const trimmed = input.trim()
  const dataUrlMatch = /^data:image\/png;base64,(.+)$/i.exec(trimmed)
  const raw = dataUrlMatch ? dataUrlMatch[1]! : trimmed

  if (!/^[A-Za-z0-9+/]+=*$/.test(raw)) {
    throw new Error('Invalid signature image encoding')
  }

  let buffer: Buffer
  try {
    buffer = Buffer.from(raw, 'base64')
  } catch {
    throw new Error('Invalid signature image encoding')
  }

  if (buffer.length === 0) {
    throw new Error('Signature image is empty')
  }
  if (buffer.length > MAX_SIGNATURE_IMAGE_BYTES) {
    throw new Error(`Signature image too large (max ${MAX_SIGNATURE_IMAGE_BYTES / 1024} KiB)`)
  }
  if (!buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new Error('Signature image must be PNG')
  }

  return buffer
}

export function hashSignatureImage(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}