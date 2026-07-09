export type JourneyStepId =
  | 'welcome'
  | 'connect'
  | 'fingerprint'
  | 'share'
  | 'sign'
  | 'seal'
  | 'verify'
  | 'done'

export type PathRole = 'creator' | 'signer' | 'verifier'

export interface JourneyStage {
  id: JourneyStepId
  label: string
  verb: string
  blurb: string
  privacyNote: string
}

/** Creator path stages shown on the journey rail (welcome/done handled separately). */
export const CREATOR_STAGES: JourneyStage[] = [
  {
    id: 'connect',
    label: 'Connect',
    verb: 'Prove who you are',
    blurb: 'Link your Nimiq wallet. Required to create, sign, or seal.',
    privacyNote: 'Wallet only proves identity — it never sees your PDF bytes.',
  },
  {
    id: 'fingerprint',
    label: 'Fingerprint',
    verb: 'Hash the PDF locally',
    blurb: 'Drop your agreement. We compute SHA-256 on this device only.',
    privacyNote: 'The file never uploads. Only the fingerprint is registered.',
  },
  {
    id: 'share',
    label: 'Share',
    verb: 'Invite co-signers',
    blurb: 'Send a link plus the same PDF out-of-band (email, AirDrop…).',
    privacyNote: 'You control the file. We only host the agreement record + link.',
  },
  {
    id: 'sign',
    label: 'Sign',
    verb: 'Everyone confirms',
    blurb: 'Each party re-fingerprints their copy, then signs with their wallet.',
    privacyNote: 'Signers prove they hold the same bytes — still no upload.',
  },
  {
    id: 'seal',
    label: 'Seal',
    verb: 'Lock on Nimiq',
    blurb: 'One transaction anchors the fingerprint on-chain forever.',
    privacyNote: 'The chain stores a hash string — never the document.',
  },
  {
    id: 'verify',
    label: 'Verify',
    verb: 'Check anytime',
    blurb: 'Anyone can drop a PDF copy and prove it still matches.',
    privacyNote: 'Verification needs no wallet and never uploads the file.',
  },
]

export interface DemoAccount {
  address: string
  shortAddress: string
}

export interface DemoDoc {
  id: string
  title: string
  fileName: string
  fileSize: number
  fingerprintPreview: string
  shareUrl: string
  signed: number
  required: number
  sealed: boolean
  directSeal: boolean
}

export function demoAddress(): DemoAccount {
  // Stable-looking fake Nimiq-style address for UI chrome only
  const raw = 'NQ07 J1A4 8V8F 2X8T 9K3M 7P5R 6H2L 4W9C'
  return {
    address: raw.replace(/\s/g, ''),
    shortAddress: 'NQ07…4W9C',
  }
}

export function fakeFingerprint(name: string, size: number): string {
  let h = size >>> 0
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) >>> 0
  const a = h.toString(16).padStart(8, '0')
  const b = (h ^ 0xa5a5a5a5).toString(16).padStart(8, '0')
  return `${a}${b}…`
}
