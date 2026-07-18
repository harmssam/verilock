/**
 * Owns create-path PDF draft persistence (IndexedDB) across Hub/Pay remounts.
 * DocumentJourney keeps React state; this hook only saves / restores / flushes.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { DocumentType } from '../types'
import {
  clearCreatePdfDraft,
  createPdfDraftFromFile,
  fileFromCreatePdfDraft,
  loadCreatePdfDraft,
  saveCreatePdfDraft,
  type CreatePdfDraftMeta,
} from './journeyPdfDraft'
import { resolveJourneyIntent, saveJourneyIntent } from './journeyIntent'
import type { PathRole } from './types'

export interface UseCreatePdfDraftArgs {
  /** Persist only on create fingerprint path (no server doc yet). */
  enabled: boolean
  bootReady: boolean
  /** When false, skip restore (already have file/doc, or non-creator path). */
  canRestore: boolean
  pdfFile: File | null
  setPdfFile: (file: File | null) => void
  meta: CreatePdfDraftMeta
  /** Apply restored form fields (title, names, type, hash, …). */
  applyRestoredMeta: (meta: {
    title: string
    creatorName: string
    creatorNotifyEmail: string
    docType: DocumentType
    docNotes: string
    pdfHash: string | null
    pageCount: number
  }) => void
  /** Ensure creator role after restore when role was null. */
  ensureCreatorRole: () => void
  role: PathRole | null
}

export interface UseCreatePdfDraftResult {
  onFileChange: (file: File | null) => void
  /** Await before Hub redirect so the put is committed. */
  flush: () => Promise<void>
  clear: () => Promise<void>
}

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

function draftMeta(
  meta: CreatePdfDraftMeta,
  role: PathRole | null,
): CreatePdfDraftMeta {
  return {
    ...meta,
    role: role === 'creator' || !role ? 'creator' : role,
  }
}

export function useCreatePdfDraft({
  enabled,
  bootReady,
  canRestore,
  pdfFile,
  setPdfFile,
  meta,
  applyRestoredMeta,
  ensureCreatorRole,
  role,
}: UseCreatePdfDraftArgs): UseCreatePdfDraftResult {
  const metaRef = useRef(meta)
  metaRef.current = meta
  const roleRef = useRef(role)
  roleRef.current = role
  const pdfFileRef = useRef(pdfFile)
  pdfFileRef.current = pdfFile

  const lastBlobKeyRef = useRef<string | null>(null)
  const restoreAttemptedRef = useRef(false)

  // Restore once after boot (post Hub return).
  useEffect(() => {
    if (!bootReady || restoreAttemptedRef.current) return
    if (!canRestore) {
      restoreAttemptedRef.current = true
      return
    }
    if (pdfFile) {
      restoreAttemptedRef.current = true
      return
    }

    // Extra guard: only create intent
    const intent = resolveJourneyIntent()
    if (intent && intent !== 'creator') {
      restoreAttemptedRef.current = true
      return
    }

    restoreAttemptedRef.current = true
    let cancelled = false
    void (async () => {
      const draft = await loadCreatePdfDraft()
      if (cancelled || !draft) return
      try {
        const file = fileFromCreatePdfDraft(draft)
        lastBlobKeyRef.current = fileKey(file)
        setPdfFile(file)
        applyRestoredMeta({
          title: draft.title,
          creatorName: draft.creatorName,
          creatorNotifyEmail: draft.creatorNotifyEmail,
          docType: draft.docType,
          docNotes: draft.docNotes,
          pdfHash: draft.pdfHash,
          pageCount: draft.pageCount,
        })
        ensureCreatorRole()
        if (!roleRef.current) {
          saveJourneyIntent('creator')
        }
      } catch {
        await clearCreatePdfDraft()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [bootReady, canRestore, pdfFile, setPdfFile, applyRestoredMeta, ensureCreatorRole])

  // Persist when the File identity changes (not on every meta keystroke).
  useEffect(() => {
    if (!enabled || !pdfFile) return
    const key = fileKey(pdfFile)
    if (lastBlobKeyRef.current === key) return
    lastBlobKeyRef.current = key
    void saveCreatePdfDraft(
      createPdfDraftFromFile(pdfFile, draftMeta(metaRef.current, roleRef.current)),
    )
  }, [enabled, pdfFile])

  const flush = useCallback(async () => {
    const file = pdfFileRef.current
    if (!file) return
    await saveCreatePdfDraft(
      createPdfDraftFromFile(file, draftMeta(metaRef.current, roleRef.current)),
    )
  }, [])

  const clear = useCallback(async () => {
    lastBlobKeyRef.current = null
    await clearCreatePdfDraft()
  }, [])

  const onFileChange = useCallback(
    (file: File | null) => {
      setPdfFile(file)
      if (!file) {
        lastBlobKeyRef.current = null
        void clearCreatePdfDraft()
        return
      }
      lastBlobKeyRef.current = fileKey(file)
      void saveCreatePdfDraft(
        createPdfDraftFromFile(file, draftMeta(metaRef.current, roleRef.current)),
      )
    },
    [setPdfFile],
  )

  return { onFileChange, flush, clear }
}
