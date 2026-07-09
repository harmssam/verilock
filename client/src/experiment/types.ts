export type CreatorStepId =
  | 'connect'
  | 'create'
  | 'share'
  | 'sign'
  | 'lock'
  | 'verify'

export interface WorkflowStepDef {
  id: CreatorStepId
  number: number
  title: string
  short: string
  detail: string
}

export const CREATOR_STEPS: WorkflowStepDef[] = [
  {
    id: 'connect',
    number: 1,
    title: 'Connect wallet',
    short: 'Approve in Nimiq Pay',
    detail: 'Prove who you are with your Nimiq wallet. Required to create or sign.',
  },
  {
    id: 'create',
    number: 2,
    title: 'Fingerprint PDF',
    short: 'Drop or choose a file',
    detail:
      'Your PDF stays on this device. Only the SHA-256 fingerprint is registered for sealing.',
  },
  {
    id: 'share',
    number: 3,
    title: 'Share link + PDF',
    short: 'Send to other signers',
    detail: 'Copy the share link and send the same PDF out-of-band (email, AirDrop, etc.).',
  },
  {
    id: 'sign',
    number: 4,
    title: 'Everyone signs',
    short: 'Verify PDF + sign',
    detail: 'Each party confirms their PDF matches, then signs with their wallet.',
  },
  {
    id: 'lock',
    number: 5,
    title: 'Lock on-chain',
    short: 'Nimiq seal transaction',
    detail: 'One transaction permanently anchors the document fingerprint on Nimiq.',
  },
  {
    id: 'verify',
    number: 6,
    title: 'Verify anytime',
    short: 'Fingerprint locally',
    detail: 'Anyone can re-fingerprint a PDF copy to confirm it was not changed.',
  },
]

export interface DemoDoc {
  id: string
  title: string
  fileName: string
  fileSize: number
  shareUrl: string
  signed: number
  required: number
  sealed: boolean
  directSeal: boolean
}

export type StepStatus = 'done' | 'current' | 'upcoming'
