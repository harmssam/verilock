/**
 * Per-document (≈ per seal / credit) annotation caps for the PDF experiment.
 * Keep in sync with server/src/security.ts.
 */

/** RDP simplification that looked good in SignatureLab. */
export const SIGNATURE_RDP_EPSILON_PX = 1.5

/**
 * Text stamps allowed on one sealed agreement (1 credit = 1 seal).
 * Enough for names, dates, initials, short notes across a few pages —
 * not a free-form document editor.
 */
export const MAX_TEXT_ANNOTATIONS = 12

/** Signature placements — matches product max co-signers (1 creator + up to 3). */
export const MAX_SIGNATURE_ANNOTATIONS = 4

/** Checkmarks + crosses (compact vector marks). */
export const MAX_MARK_ANNOTATIONS = 24

/** Hard cap on all overlays. */
export const MAX_ANNOTATIONS_TOTAL =
  MAX_SIGNATURE_ANNOTATIONS + MAX_TEXT_ANNOTATIONS + MAX_MARK_ANNOTATIONS

export function countByType(annotations: Array<{ type: string }>): {
  signatures: number
  texts: number
  marks: number
  total: number
} {
  let signatures = 0
  let texts = 0
  let marks = 0
  for (const a of annotations) {
    if (a.type === 'signature') signatures++
    else if (a.type === 'text') texts++
    else if (a.type === 'checkmark' || a.type === 'cross') marks++
  }
  return { signatures, texts, marks, total: annotations.length }
}

export function canAddSignature(annotations: Array<{ type: string }>): boolean {
  const c = countByType(annotations)
  return c.signatures < MAX_SIGNATURE_ANNOTATIONS && c.total < MAX_ANNOTATIONS_TOTAL
}

export function canAddText(annotations: Array<{ type: string }>): boolean {
  const c = countByType(annotations)
  return c.texts < MAX_TEXT_ANNOTATIONS && c.total < MAX_ANNOTATIONS_TOTAL
}

export function canAddMark(annotations: Array<{ type: string }>): boolean {
  const c = countByType(annotations)
  return c.marks < MAX_MARK_ANNOTATIONS && c.total < MAX_ANNOTATIONS_TOTAL
}
