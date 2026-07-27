/**
 * Local File / Blob reads can fail after long mobile backgrounding or when a
 * draft blob becomes inaccessible. Map browser DOMExceptions to recovery copy.
 */

/** Shown when the browser still lists a file but can no longer open its bytes. */
export const STALE_LOCAL_DOCUMENT_MESSAGE =
  'This browser can no longer open the saved document (common after leaving the tab on mobile). Choose the file again — it stays on your device and is not uploaded.'

export function isUnreadableDocumentError(err: unknown): boolean {
  if (err == null) return false
  const name =
    typeof err === 'object' && err !== null && 'name' in err
      ? String((err as { name: unknown }).name)
      : ''
  const msg =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err)

  if (
    name === 'NotFoundError' ||
    name === 'NotReadableError' ||
    name === 'InvalidStateError'
  ) {
    return true
  }
  // Safari / WebKit: "The object can not be found here."
  if (
    /object can not be found|object cannot be found|could not be read|not readable|failed to read|the requested file could not be read/i.test(
      msg,
    )
  ) {
    return true
  }
  return false
}

export function documentReadErrorMessage(err: unknown): string {
  if (isUnreadableDocumentError(err)) return STALE_LOCAL_DOCUMENT_MESSAGE
  if (err instanceof Error && err.message.trim()) return err.message
  return 'Failed to read document'
}

/**
 * Read blob bytes, or throw a user-facing Error when the handle is dead.
 * Empty size with a named draft is treated as unreadable.
 */
export async function readFileBytes(file: Blob): Promise<ArrayBuffer> {
  try {
    if (typeof file.size === 'number' && file.size <= 0) {
      throw new DOMException(STALE_LOCAL_DOCUMENT_MESSAGE, 'NotFoundError')
    }
    const buf = await file.arrayBuffer()
    // Some WebKit paths resolve with 0 bytes while reporting a non-zero size.
    if (buf.byteLength === 0 && file.size > 0) {
      throw new DOMException(STALE_LOCAL_DOCUMENT_MESSAGE, 'NotFoundError')
    }
    return buf
  } catch (err) {
    if (isUnreadableDocumentError(err)) {
      const wrapped = new Error(STALE_LOCAL_DOCUMENT_MESSAGE)
      wrapped.name = 'NotReadableError'
      throw wrapped
    }
    throw err instanceof Error ? err : new Error(String(err ?? 'Failed to read document'))
  }
}
