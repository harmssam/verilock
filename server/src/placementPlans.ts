/**
 * Construction placement plans — structure + content hashes only.
 * No PDF bytes, no signature ink. Mirrors client canonicalize for planRoot.
 */
import { createHash } from 'node:crypto'
import { normalizeAddress } from './addresses.js'
import {
  getDocumentById,
  getPartiesForDocument,
  getSignaturesForDocument,
  resolvePlacementPlan,
  upsertPlacementPlan,
  type PlacementFillBatchRecord,
  type PlacementPlanRecord,
} from './db.js'
import { canRevealParticipantDetails } from './documents.js'

/** Require a real agreement id — plans are document-scoped (same PDF may have many). */
function requireDocumentId(documentId: string | null | undefined): string {
  const id = documentId?.trim()
  if (!id) {
    throw new Error('documentId is required for placement plans')
  }
  return id
}

/** Keep in sync with client `MAX_CONSTRUCTION_PEOPLE`. */
const MAX_PEOPLE = 10
const MAX_SLOTS = 80
const MAX_NAME = 80

function q(n: unknown, digits = 4): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 0
  const p = 10 ** digits
  return Math.round(v * p) / p
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function kindToWire(kind: string): string {
  switch (kind) {
    case 'signature':
    case 's':
      return 's'
    case 'initial':
    case 'i':
      return 'i'
    case 'name':
    case 'n':
      return 'n'
    case 'text':
    case 'x':
      return 'x'
    case 'checkmark':
    case 'c':
      return 'c'
    case 'cross':
    case 'k':
      return 'k'
    default:
      return 's'
  }
}

function kindFromWire(k: string): string {
  switch (k) {
    case 's':
      return 'signature'
    case 'i':
    case 'initial':
      return 'initial'
    case 'n':
      return 'name'
    case 'x':
      return 'text'
    case 'c':
      return 'checkmark'
    case 'k':
      return 'cross'
    default:
      return 'signature'
  }
}

export interface SanitizedPerson {
  slotIndex: number
  displayName: string
  role?: string
  walletAddress?: string | null
}

export interface SanitizedSlot {
  id: string
  personSlotIndex: number
  kind: string
  pageIndex: number
  x: number
  y: number
  width: number
  height: number
  lockedContent?: {
    text?: string
    mark?: 'checkmark' | 'cross'
    fontSizeRatio?: number
    color?: string
  }
}

export interface SanitizedPlan {
  pdfSha256: string
  people: SanitizedPerson[]
  slots: SanitizedSlot[]
  status: 'draft' | 'locked'
  lockedAt?: number
  planRoot?: string
  creatorSigningAs?: number | null
}

/** Canonical plan object — must match client/src/pdf/placements.ts canonicalizePlan. */
export function canonicalizePlan(plan: {
  pdfSha256: string
  people: SanitizedPerson[]
  slots: SanitizedSlot[]
  creatorSigningAs?: number | null
}): Record<string, unknown> {
  const people = [...plan.people]
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map(p => {
      const row: Record<string, unknown> = {
        i: p.slotIndex,
        n: String(p.displayName ?? '').trim().slice(0, MAX_NAME),
      }
      if (p.role) row.r = String(p.role).slice(0, 40)
      if (p.walletAddress) row.w = normalizeAddress(p.walletAddress)
      return row
    })

  const places = [...plan.slots]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(s => {
      const row: Record<string, unknown> = {
        id: s.id,
        p: s.personSlotIndex,
        k: kindToWire(s.kind),
        page: s.pageIndex | 0,
        x: q(clamp01(s.x)),
        y: q(clamp01(s.y)),
        w: q(Math.max(1e-9, clamp01(s.width))),
        h: q(Math.max(1e-9, clamp01(s.height))),
      }
      if (s.lockedContent) {
        const lc: Record<string, unknown> = {}
        if (s.lockedContent.text != null) lc.t = String(s.lockedContent.text).slice(0, 500)
        if (s.lockedContent.mark) lc.m = s.lockedContent.mark === 'checkmark' ? 'c' : 'k'
        if (s.lockedContent.fontSizeRatio != null) lc.f = q(s.lockedContent.fontSizeRatio, 4)
        if (s.lockedContent.color) lc.c = s.lockedContent.color
        if (Object.keys(lc).length) row.lc = lc
      }
      return row
    })

  const row: Record<string, unknown> = {
    v: 2,
    pdf: plan.pdfSha256.toLowerCase(),
    people,
    places,
  }
  if (plan.creatorSigningAs == null) row.cs = null
  else row.cs = plan.creatorSigningAs | 0
  return row
}

export function computePlanRoot(plan: {
  pdfSha256: string
  people: SanitizedPerson[]
  slots: SanitizedSlot[]
  creatorSigningAs?: number | null
}): string {
  const json = JSON.stringify(canonicalizePlan(plan))
  return createHash('sha256').update(json, 'utf8').digest('hex')
}

export function sanitizePlanInput(
  body: unknown,
  pdfSha256: string,
): { ok: true; plan: SanitizedPlan } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Plan object required' }
  const o = body as Record<string, unknown>
  const hash = String(pdfSha256 || o.pdfSha256 || '')
    .replace(/^0x/i, '')
    .toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(hash)) return { ok: false, error: 'Valid pdfSha256 required' }

  const peopleIn = Array.isArray(o.people) ? o.people : []
  if (peopleIn.length < 1 || peopleIn.length > MAX_PEOPLE) {
    return { ok: false, error: `People count must be 1–${MAX_PEOPLE}` }
  }
  const people: SanitizedPerson[] = []
  const seenIdx = new Set<number>()
  for (const raw of peopleIn) {
    if (!raw || typeof raw !== 'object') continue
    const p = raw as Record<string, unknown>
    const slotIndex = Number(p.slotIndex ?? p.i)
    if (!Number.isInteger(slotIndex) || slotIndex < 1 || slotIndex > MAX_PEOPLE) {
      return { ok: false, error: 'Invalid person slotIndex' }
    }
    if (seenIdx.has(slotIndex)) return { ok: false, error: 'Duplicate person slotIndex' }
    seenIdx.add(slotIndex)
    const person: SanitizedPerson = {
      slotIndex,
      displayName: String(p.displayName ?? p.n ?? `Person ${slotIndex}`)
        .trim()
        .slice(0, MAX_NAME),
    }
    if (p.role || p.r) person.role = String(p.role ?? p.r).slice(0, 40)
    const rawW = p.walletAddress ?? p.w
    if (rawW != null && String(rawW).trim()) {
      const w = normalizeAddress(String(rawW))
      if (!/^NQ[0-9A-Z]{34}$/.test(w)) {
        return { ok: false, error: `Invalid Nimiq address for person ${slotIndex}` }
      }
      person.walletAddress = w
    } else {
      person.walletAddress = null
    }
    people.push(person)
  }
  if (people.length < 1) return { ok: false, error: 'At least one person required' }

  const slotsIn = Array.isArray(o.slots) ? o.slots : Array.isArray(o.places) ? o.places : []
  if (slotsIn.length > MAX_SLOTS) return { ok: false, error: `At most ${MAX_SLOTS} slots` }

  const slots: SanitizedSlot[] = []
  const seenIds = new Set<string>()
  for (const raw of slotsIn) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, unknown>
    const id = String(s.id ?? '').trim().slice(0, 80)
    if (!id || seenIds.has(id)) return { ok: false, error: 'Each slot needs a unique id' }
    seenIds.add(id)
    const personSlotIndex = Number(s.personSlotIndex ?? s.p)
    if (!Number.isInteger(personSlotIndex) || personSlotIndex < 1 || personSlotIndex > MAX_PEOPLE) {
      return { ok: false, error: 'Invalid slot personSlotIndex' }
    }
    const kindRaw = String(s.kind ?? s.k ?? 'signature')
    const kind = kindFromWire(kindToWire(kindRaw))
    const pageIndex = Number(s.pageIndex ?? s.page ?? 0)
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex > 200) {
      return { ok: false, error: 'Invalid pageIndex' }
    }
    const slot: SanitizedSlot = {
      id,
      personSlotIndex,
      kind,
      pageIndex,
      x: clamp01(Number(s.x)),
      y: clamp01(Number(s.y)),
      width: clamp01(Math.max(1e-9, Number(s.width ?? s.w))),
      height: clamp01(Math.max(1e-9, Number(s.height ?? s.h))),
    }
    const lc = s.lockedContent ?? s.lc
    if (lc && typeof lc === 'object') {
      const L = lc as Record<string, unknown>
      const locked: NonNullable<SanitizedSlot['lockedContent']> = {}
      if (L.text != null || L.t != null) locked.text = String(L.text ?? L.t).slice(0, 500)
      const mark = L.mark ?? L.m
      if (mark === 'checkmark' || mark === 'c') locked.mark = 'checkmark'
      if (mark === 'cross' || mark === 'k') locked.mark = 'cross'
      if (L.fontSizeRatio != null || L.f != null) {
        locked.fontSizeRatio = q(L.fontSizeRatio ?? L.f, 4)
      }
      if (L.color != null || L.c != null) locked.color = String(L.color ?? L.c).slice(0, 32)
      if (Object.keys(locked).length) slot.lockedContent = locked
    }
    slots.push(slot)
  }

  const status = o.status === 'locked' ? 'locked' : 'draft'
  const plan: SanitizedPlan = {
    pdfSha256: hash,
    people: people.sort((a, b) => a.slotIndex - b.slotIndex),
    slots,
    status,
  }
  if (typeof o.lockedAt === 'number') plan.lockedAt = o.lockedAt
  if (typeof o.planRoot === 'string' && /^[a-f0-9]{64}$/i.test(o.planRoot)) {
    plan.planRoot = o.planRoot.toLowerCase()
  }
  if (o.creatorSigningAs === null || o.cs === null) {
    plan.creatorSigningAs = null
  } else if (o.creatorSigningAs != null || o.cs != null) {
    const cs = Number(o.creatorSigningAs ?? o.cs)
    if (Number.isInteger(cs) && cs >= 1 && cs <= MAX_PEOPLE) {
      plan.creatorSigningAs = cs
    } else {
      plan.creatorSigningAs = null
    }
  }
  return { ok: true, plan }
}

function planToPublic(plan: SanitizedPlan) {
  return {
    pdfSha256: plan.pdfSha256,
    people: plan.people,
    slots: plan.slots,
    status: plan.status,
    creatorSigningAs: plan.creatorSigningAs ?? null,
    ...(plan.lockedAt != null ? { lockedAt: plan.lockedAt } : {}),
    ...(plan.planRoot ? { planRoot: plan.planRoot } : {}),
  }
}

/**
 * Whether this viewer may receive fill wire frames (ink/text payloads) for
 * reconstructing a signed document view. Mirrors document participant privacy.
 */
function canRevealFillPayload(
  rec: PlacementPlanRecord,
  viewerAddress: string | null | undefined,
): boolean {
  if (!viewerAddress) return false
  const me = normalizeAddress(viewerAddress)
  if (rec.creatorAddress && normalizeAddress(rec.creatorAddress) === me) return true
  if (!rec.documentId || rec.documentId.startsWith('legacy:')) return false
  const doc = getDocumentById(rec.documentId)
  if (!doc) return false
  const parties = getPartiesForDocument(doc.id)
  const signatures = getSignaturesForDocument(doc.id)
  return canRevealParticipantDetails(doc, parties, signatures, viewerAddress)
}

function recordToPublic(
  rec: PlacementPlanRecord,
  options?: { revealFillPayload?: boolean },
) {
  let plan: SanitizedPlan | null = null
  try {
    const parsed = JSON.parse(rec.planJson) as SanitizedPlan
    plan = {
      ...parsed,
      status: rec.status,
      planRoot: rec.planRoot ?? parsed.planRoot,
      lockedAt: rec.lockedAt ?? parsed.lockedAt,
    }
  } catch {
    plan = null
  }
  const filledSlotIds = new Set<string>()
  const knownBlobIds = new Set<string>()
  for (const b of rec.fillBatches ?? []) {
    for (const f of b.fills ?? []) filledSlotIds.add(f.slotId)
    for (const id of b.blobIds ?? []) knownBlobIds.add(id)
  }

  const revealFillPayload = Boolean(options?.revealFillPayload)

  return {
    originalSha256: rec.originalSha256,
    documentId: rec.documentId,
    creatorAddress: rec.creatorAddress,
    status: rec.status,
    planRoot: rec.planRoot,
    batch0Root: rec.batch0Root,
    slotCount: rec.slotCount,
    personCount: rec.personCount,
    lockedAt: rec.lockedAt,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    plan: plan ? planToPublic(plan) : null,
    // frames omitted for public viewers — hashes-only surface
    hasBatch0Frames: rec.batch0FramesHex.length > 0,
    batch0FrameCount: rec.batch0FramesHex.length,
    // Wire frames (BLOB payloads) only for creator / parties so they can rebuild
    // the signed document view with the local PDF.
    ...(revealFillPayload && rec.batch0FramesHex.length > 0
      ? { batch0FramesHex: rec.batch0FramesHex }
      : {}),
    fillBatchCount: (rec.fillBatches ?? []).length,
    lastBatchRoot:
      rec.fillBatches?.length
        ? rec.fillBatches[rec.fillBatches.length - 1]!.batchRoot
        : rec.batch0Root,
    filledSlotIds: [...filledSlotIds],
    knownBlobIds: [...knownBlobIds],
    fillPayloadRevealed: revealFillPayload,
    fillBatches: (rec.fillBatches ?? []).map(b => ({
      batchIndex: b.batchIndex,
      batchRoot: b.batchRoot,
      prevRoot: b.prevRoot,
      personSlotIndex: b.personSlotIndex,
      signerAddress: b.signerAddress,
      blobIds: b.blobIds,
      fills: b.fills,
      createdAt: b.createdAt,
      frameCount: b.framesHex?.length ?? 0,
      ...(revealFillPayload && b.framesHex?.length ? { framesHex: b.framesHex } : {}),
    })),
  }
}

export function saveDraftPlan(input: {
  originalSha256: string
  creatorAddress: string
  plan: unknown
  documentId?: string | null
}): ReturnType<typeof recordToPublic> {
  const sanitized = sanitizePlanInput(input.plan, input.originalSha256)
  if (!sanitized.ok) throw new Error(sanitized.error)

  const documentId = requireDocumentId(input.documentId)
  const existing = resolvePlacementPlan({
    originalSha256: input.originalSha256,
    documentId,
  })
  if (existing?.status === 'locked') {
    throw new Error('Placements are locked and cannot be edited')
  }
  const publisher = normalizeAddress(input.creatorAddress)
  if (
    existing &&
    existing.creatorAddress &&
    normalizeAddress(existing.creatorAddress) !== publisher
  ) {
    throw new Error('Only the plan owner can update this placement plan')
  }

  const plan: SanitizedPlan = { ...sanitized.plan, status: 'draft' }
  delete plan.planRoot
  delete plan.lockedAt
  const now = Date.now()
  const rec: PlacementPlanRecord = {
    originalSha256: plan.pdfSha256,
    documentId,
    creatorAddress: publisher,
    status: 'draft',
    planJson: JSON.stringify(planToPublic(plan)),
    planRoot: null,
    batch0FramesHex: [],
    batch0Root: null,
    fillBatches: [],
    slotCount: plan.slots.length,
    personCount: plan.people.length,
    lockedAt: null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertPlacementPlan(rec)
  return recordToPublic(rec)
}

/**
 * Re-open a locked plan as draft so the creator can rearrange.
 * Allowed only before any fill batch or document signature exists.
 */
export function unlockPlan(input: {
  originalSha256: string
  creatorAddress: string
  documentId?: string | null
}): ReturnType<typeof recordToPublic> {
  const sha = input.originalSha256.toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(sha)) {
    throw new Error('Valid originalSha256 required')
  }
  const documentId = requireDocumentId(input.documentId)
  const existing = resolvePlacementPlan({
    originalSha256: sha,
    documentId,
  })
  if (!existing) {
    throw new Error('No placement plan for this agreement')
  }
  const publisher = normalizeAddress(input.creatorAddress)
  if (
    existing.creatorAddress &&
    normalizeAddress(existing.creatorAddress) !== publisher
  ) {
    throw new Error('Only the plan owner can unlock this placement plan')
  }
  if (existing.status !== 'locked') {
    // Already editable — return current public view.
    return recordToPublic(existing)
  }
  if ((existing.fillBatches ?? []).length > 0) {
    throw new Error('Cannot edit placements after someone has filled fields')
  }
  if (!documentId.startsWith('legacy:')) {
    const signatures = getSignaturesForDocument(documentId)
    if (signatures.length > 0) {
      throw new Error('Cannot edit placements after someone has signed')
    }
  }

  let plan: SanitizedPlan
  try {
    const parsed = JSON.parse(existing.planJson) as unknown
    const sanitized = sanitizePlanInput(parsed, sha)
    if (!sanitized.ok) throw new Error(sanitized.error)
    plan = { ...sanitized.plan, status: 'draft' }
    delete plan.planRoot
    delete plan.lockedAt
  } catch {
    throw new Error('Could not re-open placement plan')
  }

  const now = Date.now()
  const rec: PlacementPlanRecord = {
    originalSha256: sha,
    documentId,
    creatorAddress: publisher,
    status: 'draft',
    planJson: JSON.stringify(planToPublic(plan)),
    planRoot: null,
    batch0FramesHex: [],
    batch0Root: null,
    fillBatches: [],
    slotCount: plan.slots.length,
    personCount: plan.people.length,
    lockedAt: null,
    createdAt: existing.createdAt,
    updatedAt: now,
  }
  upsertPlacementPlan(rec)
  return recordToPublic(rec)
}

export function lockPlan(input: {
  originalSha256: string
  creatorAddress: string
  plan: unknown
  planRoot?: string
  batch0FramesHex?: string[]
  batch0Root?: string
  documentId?: string | null
}): ReturnType<typeof recordToPublic> {
  const sanitized = sanitizePlanInput(input.plan, input.originalSha256)
  if (!sanitized.ok) throw new Error(sanitized.error)
  if (sanitized.plan.slots.length === 0) {
    throw new Error('Add at least one placement before locking')
  }
  if (
    !sanitized.plan.slots.some(
      s =>
        s.kind === 'signature' ||
        s.kind === 'initial' ||
        s.kind === 'name' ||
        s.kind === 'text',
    )
  ) {
    throw new Error('Add at least one signature, initial, name, or text field before locking')
  }

  const documentId = requireDocumentId(input.documentId)
  const existing = resolvePlacementPlan({
    originalSha256: input.originalSha256,
    documentId,
  })
  if (existing?.status === 'locked') {
    throw new Error('Placements are already locked')
  }
  const publisher = normalizeAddress(input.creatorAddress)
  if (
    existing &&
    existing.creatorAddress &&
    normalizeAddress(existing.creatorAddress) !== publisher
  ) {
    throw new Error('Only the plan owner can lock this placement plan')
  }

  const expectedRoot = computePlanRoot(sanitized.plan)
  const clientRoot = (input.planRoot || sanitized.plan.planRoot || '').toLowerCase()
  if (clientRoot && clientRoot !== expectedRoot) {
    throw new Error('planRoot mismatch — recompute after last edit')
  }

  const now = Date.now()
  const plan: SanitizedPlan = {
    ...sanitized.plan,
    status: 'locked',
    planRoot: expectedRoot,
    lockedAt: now,
  }

  const frames = Array.isArray(input.batch0FramesHex)
    ? input.batch0FramesHex
        .filter(h => typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h))
        .map(h => h.toLowerCase())
        .slice(0, 128)
    : []

  const batch0Root =
    input.batch0Root && /^[a-f0-9]{64}$/i.test(input.batch0Root)
      ? input.batch0Root.toLowerCase()
      : null

  const rec: PlacementPlanRecord = {
    originalSha256: plan.pdfSha256,
    documentId,
    creatorAddress: publisher,
    status: 'locked',
    planJson: JSON.stringify(planToPublic(plan)),
    planRoot: expectedRoot,
    batch0FramesHex: frames,
    batch0Root,
    fillBatches: [],
    slotCount: plan.slots.length,
    personCount: plan.people.length,
    lockedAt: now,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  upsertPlacementPlan(rec)
  return recordToPublic(rec)
}

/**
 * Recompute batchRoot = sha256(payload) from packed v2 frames (HEAD+DATA*+END).
 * Returns null if frames cannot be parsed.
 */
function recomputeBatchRootFromFrames(framesHex: string[]): string | null {
  if (framesHex.length < 2) return null
  const frames: Buffer[] = []
  for (const h of framesHex) {
    const clean = h.replace(/^0x/i, '').toLowerCase()
    if (clean.length !== 128 || !/^[0-9a-f]+$/.test(clean)) return null
    frames.push(Buffer.from(clean, 'hex'))
  }
  frames.sort((a, b) => a[3]! - b[3]!)
  const head = frames[0]!
  if (head[0] !== 0xa1 || head[1] !== 2 || head[2] !== 1) return null
  const total = head[4]!
  if (frames.length !== total) return null
  const payloadLen = head.readUInt32BE(9 + 32)
  const checksum = head.readUInt32BE(9 + 38)
  const parts: Buffer[] = []
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!
    if (f[0] !== 0xa1 || f[1] !== 2) return null
    if (f[2] === 2) parts.push(f.subarray(9))
  }
  const joined = Buffer.concat(parts).subarray(0, payloadLen)
  // light CRC check matching packer
  let c = 0xffffffff
  for (let i = 0; i < joined.length; i++) {
    c ^= joined[i]!
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  const crc = (c ^ 0xffffffff) >>> 0
  if (crc !== checksum) return null
  return createHash('sha256').update(joined).digest('hex')
}

/**
 * Append a fill batch after plan lock. Stores blob_ids + frames hex (wire cache);
 * does not store PNG ink. Dedup is client-side; server rejects double-fill of same slot.
 */
export function appendFillBatch(input: {
  originalSha256: string
  signerAddress: string
  personSlotIndex: number
  prevRoot: string
  batchRoot: string
  batchIndex: number
  framesHex?: string[]
  fills: Array<{ slotId: string; blobId: string; personSlotIndex: number }>
  blobIds: string[]
  documentId?: string | null
}): ReturnType<typeof recordToPublic> {
  const hash = input.originalSha256.toLowerCase()
  const documentId = requireDocumentId(input.documentId)
  const existing = resolvePlacementPlan({
    originalSha256: hash,
    documentId,
  })
  if (!existing || existing.status !== 'locked') {
    throw new Error('Placements must be locked before filling')
  }
  if (!existing.planRoot) throw new Error('Plan root missing')
  if (!/^[a-f0-9]{64}$/i.test(input.prevRoot)) throw new Error('Invalid prevRoot')
  if (!/^[a-f0-9]{64}$/i.test(input.batchRoot)) throw new Error('Invalid batchRoot')

  const expectedPrev =
    existing.fillBatches.length > 0
      ? existing.fillBatches[existing.fillBatches.length - 1]!.batchRoot
      : existing.batch0Root || existing.planRoot
  if (expectedPrev && input.prevRoot.toLowerCase() !== expectedPrev.toLowerCase()) {
    throw new Error('prevRoot does not match latest batch — refresh and retry')
  }

  const expectedIndex = existing.fillBatches.length + 1
  if (input.batchIndex !== expectedIndex) {
    throw new Error(`Expected batchIndex ${expectedIndex}, got ${input.batchIndex}`)
  }

  let plan: SanitizedPlan | null = null
  try {
    plan = JSON.parse(existing.planJson) as SanitizedPlan
  } catch {
    plan = null
  }
  if (!plan?.slots?.length) throw new Error('Locked plan has no slots')

  const personIdx = Number(input.personSlotIndex)
  if (!Number.isInteger(personIdx) || personIdx < 1 || personIdx > MAX_PEOPLE) {
    throw new Error('Invalid personSlotIndex')
  }

  // Authorize: wallet may fill only for a roster party they own or an open slot.
  if (existing.documentId && !existing.documentId.startsWith('legacy:')) {
    const doc = getDocumentById(existing.documentId)
    if (doc) {
      const parties = getPartiesForDocument(doc.id)
        .filter(p => p.required)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const party = parties[personIdx - 1]
      if (!party) {
        throw new Error('No signing party for this person slot')
      }
      const me = normalizeAddress(input.signerAddress)
      if (party.walletAddress) {
        if (normalizeAddress(party.walletAddress) !== me) {
          throw new Error('Wallet is not assigned to this person')
        }
      } else {
        // Open slot: block wallets that already signed a different party
        const sigs = getSignaturesForDocument(doc.id)
        const already = sigs.find(s => normalizeAddress(s.signerAddress) === me)
        if (already && already.partyId !== party.id) {
          throw new Error('Wallet already signed as a different party')
        }
      }
    }
  }

  const slotsById = new Map(plan.slots.map(s => [s.id, s]))
  const alreadyFilled = new Set<string>()
  for (const b of existing.fillBatches) {
    for (const f of b.fills) alreadyFilled.add(f.slotId)
  }

  const fills: PlacementFillBatchRecord['fills'] = []
  const blobIds = new Set<string>()
  for (const f of input.fills) {
    const slot = slotsById.get(f.slotId)
    if (!slot) {
      throw new Error(`Unknown slot ${f.slotId}`)
    }
    if (Number(slot.personSlotIndex) !== personIdx) {
      throw new Error('Slot is not assigned to this person')
    }
    if (alreadyFilled.has(f.slotId)) {
      throw new Error(`Slot already filled: ${f.slotId}`)
    }
    if (!/^[a-f0-9]{32}$/i.test(f.blobId)) {
      throw new Error('blobId must be 32 hex chars')
    }
    if (Number(f.personSlotIndex) !== personIdx) {
      throw new Error('Fill personSlotIndex mismatch')
    }
    fills.push({
      slotId: f.slotId,
      blobId: f.blobId.toLowerCase(),
      personSlotIndex: personIdx,
    })
    blobIds.add(f.blobId.toLowerCase())
  }
  if (fills.length === 0) throw new Error('At least one fill required')

  for (const id of input.blobIds ?? []) {
    if (/^[a-f0-9]{32}$/i.test(id)) blobIds.add(id.toLowerCase())
  }

  const frames = Array.isArray(input.framesHex)
    ? input.framesHex
        .filter(h => typeof h === 'string' && /^[a-f0-9]{128}$/i.test(h))
        .map(h => h.toLowerCase())
        .slice(0, 128)
    : []

  // When wire frames are provided, recompute batchRoot from payload (hashes-only integrity).
  let batchRoot = input.batchRoot.toLowerCase()
  if (frames.length > 0) {
    try {
      const recomputed = recomputeBatchRootFromFrames(frames)
      if (recomputed && recomputed !== batchRoot) {
        throw new Error('batchRoot does not match provided frames')
      }
      if (recomputed) batchRoot = recomputed
    } catch (err) {
      if (err instanceof Error && err.message.includes('batchRoot')) throw err
      // Malformed frames — still store roots if client hash is well-formed
    }
  }

  const batch: PlacementFillBatchRecord = {
    batchIndex: expectedIndex,
    batchRoot,
    prevRoot: input.prevRoot.toLowerCase(),
    personSlotIndex: personIdx,
    signerAddress: normalizeAddress(input.signerAddress),
    framesHex: frames,
    blobIds: [...blobIds],
    fills,
    createdAt: Date.now(),
  }

  const rec: PlacementPlanRecord = {
    ...existing,
    fillBatches: [...existing.fillBatches, batch],
    updatedAt: Date.now(),
  }
  upsertPlacementPlan(rec)
  return recordToPublic(rec)
}

export function getPlanPublic(
  originalSha256: string,
  options?: { viewerAddress?: string | null; documentId?: string | null },
) {
  const rec = resolvePlacementPlan({
    originalSha256,
    documentId: options?.documentId,
  })
  if (!rec) return null
  const revealFillPayload = canRevealFillPayload(rec, options?.viewerAddress)
  return recordToPublic(rec, { revealFillPayload })
}
