/**
 * Persist create-path PDF draft across Hub/Pay login redirects.
 * File objects only live in React memory — a full-page Hub return remounts the SPA.
 *
 * IndexedDB (binary-safe). Writes wait for transaction complete before resolving
 * so a Hub redirect does not race an incomplete put.
 *
 * Form fields (agreement type, title, names, notes) also live in sessionStorage so
 * they survive Hub remounts without re-writing the PDF blob on every keystroke.
 * Header Login (shell AccountMenu) does not go through DocumentJourney.disconnect
 * flush paths — the form cache is the reliable channel for those fields.
 */

import type { DocumentType } from '../types'
import type { PathRole } from './types'

const DB_NAME = 'verilock-journey'
const DB_VERSION = 1
const STORE = 'drafts'
const CREATE_KEY = 'create-pdf'
/** Drop drafts older than 24h (stale tab after abandon). */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Lightweight form sidecar — survives full-page Hub return in the same tab. */
const CREATE_FORM_CACHE_KEY = 'verilock-create-form-v1'

export interface CreatePdfDraftMeta {
  title: string
  creatorName: string
  creatorNotifyEmail: string
  docType: DocumentType
  docNotes: string
  pdfHash: string | null
  pageCount: number
  role: PathRole | null
}

/** Form fields only (not hash / pageCount / role). */
export type CreateFormCache = Pick<
  CreatePdfDraftMeta,
  'title' | 'creatorName' | 'creatorNotifyEmail' | 'docType' | 'docNotes'
>

const DOCUMENT_TYPES: readonly DocumentType[] = ['rental', 'contract', 'nda', 'other']

function isDocumentType(v: unknown): v is DocumentType {
  return typeof v === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(v)
}

export function saveCreateFormCache(fields: CreateFormCache): void {
  try {
    sessionStorage.setItem(CREATE_FORM_CACHE_KEY, JSON.stringify(fields))
  } catch {
    /* private mode */
  }
}

export function loadCreateFormCache(): CreateFormCache | null {
  try {
    const raw = sessionStorage.getItem(CREATE_FORM_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CreateFormCache>
    if (!parsed || typeof parsed !== 'object') return null
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      creatorName: typeof parsed.creatorName === 'string' ? parsed.creatorName : '',
      creatorNotifyEmail:
        typeof parsed.creatorNotifyEmail === 'string' ? parsed.creatorNotifyEmail : '',
      docType: isDocumentType(parsed.docType) ? parsed.docType : 'contract',
      docNotes: typeof parsed.docNotes === 'string' ? parsed.docNotes : '',
    }
  } catch {
    return null
  }
}

export function clearCreateFormCache(): void {
  try {
    sessionStorage.removeItem(CREATE_FORM_CACHE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Module-level flush so shell header Login can commit the create PDF draft
 * before Hub redirect (DocumentJourney owns the File + latest meta).
 */
type CreatePdfDraftFlushFn = () => Promise<void>
let createPdfDraftFlushHandler: CreatePdfDraftFlushFn | null = null

export function setCreatePdfDraftFlushHandler(fn: CreatePdfDraftFlushFn | null): void {
  createPdfDraftFlushHandler = fn
}

/** Await before any Hub-bound connect that may remount the SPA. */
export async function flushCreatePdfDraftIfNeeded(): Promise<void> {
  if (createPdfDraftFlushHandler) {
    await createPdfDraftFlushHandler()
  }
}

export interface CreatePdfDraft extends CreatePdfDraftMeta {
  fileName: string
  fileType: string
  lastModified: number
  blob: Blob
  savedAt: number
}

export type CreatePdfDraftInput = Omit<CreatePdfDraft, 'savedAt'> & { savedAt?: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
    }
  })
}

/** Run a store op and resolve only after the transaction commits. */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    let result: T | undefined
    const tx = db.transaction(STORE, mode)
    const req = run(tx.objectStore(STORE))
    req.onsuccess = () => {
      result = req.result
    }
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB request failed'))
    }
    tx.oncomplete = () => {
      db.close()
      resolve(result as T)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB transaction failed'))
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    }
  })
}

export async function saveCreatePdfDraft(draft: CreatePdfDraftInput): Promise<void> {
  try {
    const payload: CreatePdfDraft = {
      ...draft,
      savedAt: draft.savedAt ?? Date.now(),
    }
    await withStore('readwrite', store => store.put(payload, CREATE_KEY))
  } catch {
    /* private mode / quota — non-fatal */
  }
}

export async function loadCreatePdfDraft(): Promise<CreatePdfDraft | null> {
  try {
    const raw = await withStore('readonly', store => store.get(CREATE_KEY))
    if (!raw || typeof raw !== 'object') return null
    const draft = raw as CreatePdfDraft
    if (!draft.blob || !draft.fileName) return null
    if (typeof draft.savedAt === 'number' && Date.now() - draft.savedAt > MAX_AGE_MS) {
      await clearCreatePdfDraft()
      return null
    }
    return draft
  } catch {
    return null
  }
}

export async function clearCreatePdfDraft(): Promise<void> {
  try {
    await withStore('readwrite', store => store.delete(CREATE_KEY))
  } catch {
    /* ignore */
  }
}

/** Rebuild a File from a stored draft for React state. */
export function fileFromCreatePdfDraft(draft: CreatePdfDraft): File {
  return new File([draft.blob], draft.fileName, {
    type: draft.fileType || '',
    lastModified: draft.lastModified || Date.now(),
  })
}

export function createPdfDraftFromFile(
  file: File,
  meta: CreatePdfDraftMeta,
): CreatePdfDraftInput {
  return {
    fileName: file.name,
    fileType: file.type || '',
    lastModified: file.lastModified,
    blob: file,
    ...meta,
  }
}
