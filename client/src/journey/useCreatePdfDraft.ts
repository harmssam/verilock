/**
 * Owns create-path PDF draft persistence (IndexedDB) across Hub/Pay remounts.
 * DocumentJourney keeps React state; this hook only saves / restores / flushes.
 *
 * Form fields (docType, title, …) are also mirrored to sessionStorage so they
 * survive Hub remounts even when Login is started from the shell header (which
 * does not await DocumentJourney’s connect flush).
 */

import { useCallback, useEffect, useRef } from 'react'
import type { DocumentType } from '../types'
import {
  clearCreateFormCache,
  clearCreatePdfDraft,
  createPdfDraftFromFile,
  fileFromCreatePdfDraft,
  loadCreateFormCache,
  loadCreatePdfDraft,
  saveCreateFormCache,
  saveCreatePdfDraft,
  setCreatePdfDraftFlushHandler,
  type CreateFormCache,
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

function formFieldsFromMeta(meta: CreatePdfDraftMeta): CreateFormCache {
  return {
    title: meta.title,
    creatorName: meta.creatorName,
    creatorNotifyEmail: meta.creatorNotifyEmail,
    docType: meta.docType,
    docNotes: meta.docNotes,
  }
}

/** Prefer session form cache (latest UI) over IndexedDB draft meta (may be stale). */
function mergeFormFields(
  draft: CreateFormCache | null | undefined,
  cache: CreateFormCache | null,
): CreateFormCache {
  if (cache) return cache
  if (draft) {
    return {
      title: draft.title ?? '',
      creatorName: draft.creatorName ?? '',
      creatorNotifyEmail: draft.creatorNotifyEmail ?? '',
      docType: draft.docType ?? 'contract',
      docNotes: draft.docNotes ?? '',
    }
  }
  return {
    title: '',
    creatorName: '',
    creatorNotifyEmail: '',
    docType: 'contract',
    docNotes: '',
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

  // Mirror form fields to sessionStorage whenever the create path is active.
  // Cheap (no PDF blob) — covers type/title changes before/after file select.
  useEffect(() => {
    if (!enabled) return
    saveCreateFormCache(formFieldsFromMeta(meta))
  }, [
    enabled,
    meta.title,
    meta.creatorName,
    meta.creatorNotifyEmail,
    meta.docType,
    meta.docNotes,
  ])

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
      const formCache = loadCreateFormCache()
      if (cancelled) return

      // Apply form fields even when there is no PDF yet (type selected pre-upload).
      const form = mergeFormFields(draft ?? undefined, formCache)
      if (draft || formCache) {
        applyRestoredMeta({
          title: form.title,
          creatorName: form.creatorName,
          creatorNotifyEmail: form.creatorNotifyEmail,
          docType: form.docType,
          docNotes: form.docNotes,
          pdfHash: draft?.pdfHash ?? null,
          pageCount: draft?.pageCount && draft.pageCount > 0 ? draft.pageCount : 0,
        })
      }

      if (!draft) return
      try {
        const file = fileFromCreatePdfDraft(draft)
        lastBlobKeyRef.current = fileKey(file)
        setPdfFile(file)
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

  // Persist when the File identity changes (blob write — not every meta keystroke).
  useEffect(() => {
    if (!enabled || !pdfFile) return
    const key = fileKey(pdfFile)
    if (lastBlobKeyRef.current === key) return
    lastBlobKeyRef.current = key
    void saveCreatePdfDraft(
      createPdfDraftFromFile(pdfFile, draftMeta(metaRef.current, roleRef.current)),
    )
  }, [enabled, pdfFile])

  // After restore, keep IndexedDB draft meta in sync when form fields change
  // (still only when a file is present — uses current blob, not a re-read).
  // Debounce slightly so title typing does not thrash large puts.
  useEffect(() => {
    if (!enabled || !pdfFile) return
    if (!restoreAttemptedRef.current) return
    const key = fileKey(pdfFile)
    // Skip the first identity write (handled by the file effect / onFileChange).
    if (lastBlobKeyRef.current !== key) return

    const timer = window.setTimeout(() => {
      void saveCreatePdfDraft(
        createPdfDraftFromFile(pdfFile, draftMeta(metaRef.current, roleRef.current)),
      )
    }, 300)
    return () => window.clearTimeout(timer)
  }, [
    enabled,
    pdfFile,
    meta.title,
    meta.creatorName,
    meta.creatorNotifyEmail,
    meta.docType,
    meta.docNotes,
    meta.pdfHash,
    meta.pageCount,
    role,
  ])

  const flush = useCallback(async () => {
    const file = pdfFileRef.current
    // Always commit form cache (works even if PDF not chosen yet).
    saveCreateFormCache(formFieldsFromMeta(metaRef.current))
    if (!file) return
    await saveCreatePdfDraft(
      createPdfDraftFromFile(file, draftMeta(metaRef.current, roleRef.current)),
    )
  }, [])

  // Shell header Login can remount the SPA without DocumentJourney.connectFromPath.
  useEffect(() => {
    if (!enabled) {
      setCreatePdfDraftFlushHandler(null)
      return
    }
    setCreatePdfDraftFlushHandler(flush)
    return () => setCreatePdfDraftFlushHandler(null)
  }, [enabled, flush])

  const clear = useCallback(async () => {
    lastBlobKeyRef.current = null
    clearCreateFormCache()
    await clearCreatePdfDraft()
  }, [])

  const onFileChange = useCallback(
    (file: File | null) => {
      setPdfFile(file)
      if (!file) {
        lastBlobKeyRef.current = null
        void clearCreatePdfDraft()
        // Keep form cache so type/title survive clearing the file.
        return
      }
      lastBlobKeyRef.current = fileKey(file)
      void saveCreatePdfDraft(
        createPdfDraftFromFile(file, draftMeta(metaRef.current, roleRef.current)),
      )
      saveCreateFormCache(formFieldsFromMeta(metaRef.current))
    },
    [setPdfFile],
  )

  return { onFileChange, flush, clear }
}
