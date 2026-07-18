/**
 * When a session appears (or changes) and the open agreement is still the public
 * redacted payload, re-fetch with the token so parties/creators get names + ink.
 */

import { useEffect, useRef } from 'react'
import { api } from '../api'
import type { SealDocument } from '../types'
import type { JourneyDoc } from './types'

export function useRevealDocumentOnAuth(
  doc: JourneyDoc | null,
  token: string | null,
  onDocument: (document: SealDocument, fileSize?: number) => void,
): void {
  const onDocumentRef = useRef(onDocument)
  onDocumentRef.current = onDocument

  const fileSizeRef = useRef(0)
  if (doc) fileSizeRef.current = doc.fileSize

  useEffect(() => {
    if (!doc || !token) return
    // Already unlocked for this viewer — nothing to do.
    if (doc.source.participantDetailsRevealed === true) return

    let cancelled = false
    const slug = doc.slug
    const size = fileSizeRef.current
    void (async () => {
      try {
        const { document } = await api.getDocument(slug, token)
        if (cancelled) return
        if (document.participantDetailsRevealed) {
          onDocumentRef.current(document, size)
        }
      } catch {
        /* keep redacted view */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc?.id, doc?.slug, doc?.source.participantDetailsRevealed, token])
}
