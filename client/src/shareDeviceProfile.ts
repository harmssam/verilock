/**
 * Device-aware ranking for share-step invite actions.
 * Capability checks (e.g. canShareFiles) still gate which actions exist;
 * this module chooses primary / secondary / more for reliability per platform.
 */

export type SharePlatform = 'ios' | 'android' | 'mac' | 'windows' | 'other'

/** Actions available when a local PDF is in session. */
export type ShareActionId = 'web-share' | 'open-mail' | 'eml' | 'copy-link'

export interface ShareActionPlan {
  platform: SharePlatform
  isMobile: boolean
  webShareFiles: boolean
  /** High-confidence CTAs (usually one full-width primary). */
  primary: ShareActionId[]
  /** Always-visible secondary actions (e.g. copy link). */
  secondary: ShareActionId[]
  /** Reliable but secondary paths — shown under “More ways to share”. */
  more: ShareActionId[]
}

export function detectSharePlatform(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
): SharePlatform {
  if (typeof nav === 'undefined' || !nav.userAgent) return 'other'
  const ua = nav.userAgent
  // iPadOS 13+ often reports as Macintosh with touch.
  const isIpad =
    /iPad/i.test(ua) ||
    (nav.platform === 'MacIntel' && typeof nav.maxTouchPoints === 'number' && nav.maxTouchPoints > 1)
  if (/iPhone|iPod/i.test(ua) || isIpad) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  if (/Win/i.test(nav.platform) || /Windows NT/i.test(ua)) return 'windows'
  if (/Mac/i.test(nav.platform) || /Macintosh/i.test(ua)) return 'mac'
  return 'other'
}

export function isMobileSharePlatform(platform: SharePlatform): boolean {
  return platform === 'ios' || platform === 'android'
}

/**
 * Rank share actions for the current device.
 * @param webShareFiles — result of canShareFiles([pdf]); re-evaluate if share fails.
 */
export function buildShareActionPlan(options: {
  webShareFiles: boolean
  platform?: SharePlatform
}): ShareActionPlan {
  const platform = options.platform ?? detectSharePlatform()
  const isMobile = isMobileSharePlatform(platform)
  const webShareFiles = Boolean(options.webShareFiles)

  if (isMobile) {
    if (webShareFiles) {
      return {
        platform,
        isMobile,
        webShareFiles,
        primary: ['web-share'],
        secondary: ['copy-link'],
        more: ['open-mail', 'eml'],
      }
    }
    return {
      platform,
      isMobile,
      webShareFiles,
      primary: ['open-mail'],
      secondary: ['copy-link'],
      more: ['eml'],
    }
  }

  if (platform === 'mac') {
    return {
      platform,
      isMobile,
      webShareFiles,
      primary: ['open-mail'],
      secondary: ['copy-link'],
      more: [...(webShareFiles ? (['web-share'] as const) : []), 'eml'],
    }
  }

  if (platform === 'windows') {
    return {
      platform,
      isMobile,
      webShareFiles,
      primary: ['eml'],
      secondary: ['open-mail'],
      more: ['copy-link', ...(webShareFiles ? (['web-share'] as const) : [])],
    }
  }

  // Linux / unknown desktop: mailto is the most universal default client path.
  return {
    platform,
    isMobile,
    webShareFiles,
    primary: ['open-mail'],
    secondary: ['copy-link'],
    more: ['eml', ...(webShareFiles ? (['web-share'] as const) : [])],
  }
}

/** Short intro under the share card title (PDF in session). */
export function shareIntroForPlan(plan: ShareActionPlan, pdfName: string): string {
  if (plan.isMobile && plan.webShareFiles) {
    return `Add the co-signer email if you want Mail pre-filled, then share ${pdfName} with the invite via the system share sheet. VeriLock never hosts the file.`
  }
  if (plan.platform === 'windows') {
    return `Add the co-signer email, then download the .eml package — Outlook opens a draft with ${pdfName} attached. VeriLock never hosts the file.`
  }
  if (plan.platform === 'mac') {
    return `Add the co-signer email, then open Mail with To filled and download ${pdfName} to attach. VeriLock never hosts the file.`
  }
  return `Add the co-signer email, then open your mail app with To filled and download ${pdfName} to attach. VeriLock never hosts the file.`
}

/** Hint under the action buttons (PDF in session). */
export function shareHintForPlan(plan: ShareActionPlan, pdfName: string): string {
  if (plan.isMobile && plan.webShareFiles) {
    return `Share PDF + invite opens the system sheet (Mail, Messages, and more) with the file. Open in Mail and the .eml package are under More ways to share if you need them. VeriLock never uploads the PDF.`
  }
  if (plan.isMobile) {
    return `Open in Mail starts a compose window with To filled and downloads ${pdfName} so you can attach it. Browsers cannot put attachments on mailto. VeriLock never uploads the PDF.`
  }
  if (plan.platform === 'windows') {
    return `The .eml package is a single draft with To set and ${pdfName} inside — best for Outlook. Open in Mail uses your default client without an attachment (attach the PDF yourself). VeriLock never uploads the PDF.`
  }
  if (plan.platform === 'mac') {
    return `Open in Mail is the reliable path on Apple Mail: a real compose window with To filled, and ${pdfName} downloads for you to attach (browsers cannot put attachments on mailto). The optional .eml package is useful for Outlook, but Apple Mail often leaves To blank on import. VeriLock never uploads the PDF.`
  }
  return `Open in Mail opens your default client with To filled and downloads ${pdfName} for you to attach. The .eml package includes the PDF in one file for clients that open drafts well. VeriLock never uploads the PDF.`
}

export type ShareInstructionKind =
  | 'web-share'
  | 'open-mail'
  | 'eml'
  | 'generic-link-pdf'

/** Ordered how-to steps for the signing-link block. */
export function shareInstructionKinds(plan: ShareActionPlan): ShareInstructionKind[] {
  const lead = plan.primary[0]
  if (lead === 'web-share') return ['web-share', 'open-mail']
  if (lead === 'eml') return ['eml', 'open-mail']
  if (lead === 'open-mail') return ['open-mail']
  return ['generic-link-pdf']
}

/** Label for recipients field when Mail / .eml is relevant. */
export function shareRecipientsHint(plan: ShareActionPlan): string {
  if (plan.platform === 'mac' || plan.primary[0] === 'open-mail') {
    return 'Apple Mail and most desktop clients fill To via compose (not .eml import). Synced from co-signer invite emails above when set.'
  }
  if (plan.platform === 'windows' || plan.primary[0] === 'eml') {
    return 'Used for the .eml To header and for Open in Mail. Synced from co-signer invite emails above when set.'
  }
  if (plan.isMobile && plan.webShareFiles) {
    return 'Optional for the share sheet; required if you use Open in Mail under More. Synced from co-signer invite emails above when set.'
  }
  return 'Required for Mail compose. Synced from co-signer invite emails above when set.'
}

/** Whether the To field is required before the primary action. */
export function primaryActionRequiresRecipients(plan: ShareActionPlan): boolean {
  const lead = plan.primary[0]
  return lead === 'open-mail' || lead === 'eml'
}
