import { Check, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import type { ReactNode } from 'react'
import { ShareInviteCard } from './ShareInviteCard'
import { normalizeAddress } from './addresses'
import { formatSealFeeSummary } from './sealPricing'
import { TextLink } from './TextLink'
import type { AppScreen, SealDocument } from './types'
import './WorkflowGuide.css'

export type CreatorStepId =
  | 'connect'
  | 'create'
  | 'share'
  | 'sign'
  | 'lock'
  | 'verify'

export type SignerStepId = 'connect' | 'sign' | 'done'

export type WorkflowStepId = CreatorStepId | SignerStepId

interface StepDef {
  id: WorkflowStepId
  title: string
  detail: string
  short: string
}

export const CREATOR_STEPS: StepDef[] = [
  {
    id: 'connect',
    title: 'Connect wallet',
    short: 'Approve in Nimiq Pay',
    detail: 'Tap Connect wallet and approve in Nimiq Pay. This proves who you are.',
  },
  {
    id: 'create',
    title: 'Fingerprint PDF',
    short: 'New agreement tab',
    detail: 'Open New agreement, choose your PDF on your computer, and tap Create agreement. The file never leaves your device — only the fingerprint is saved.',
  },
  {
    id: 'share',
    title: 'Share link + PDF',
    short: 'Send to other signer',
    detail: 'Copy the share link and send the same PDF file to the tenant or other party (email, AirDrop, etc.).',
  },
  {
    id: 'sign',
    title: 'Everyone signs',
    short: 'Verify PDF + sign',
    detail: 'Each party opens the link, chooses the PDF on their own computer to verify it matches, connects their wallet, and signs.',
  },
  {
    id: 'lock',
    title: 'Lock on-chain',
    short: 'Nimiq seal transaction',
    detail: `When all required signatures are in, approve one Nimiq transaction (${formatSealFeeSummary()}) to permanently record the file hash on-chain.`,
  },
  {
    id: 'verify',
    title: 'Verify anytime',
    short: 'Fingerprint locally',
    detail: 'Anyone can fingerprint their PDF locally on Verify to confirm it was not changed.',
  },
]

/** @deprecated Use CREATOR_STEPS */
export const STEPS = CREATOR_STEPS

export const SIGNER_STEPS: StepDef[] = [
  {
    id: 'connect',
    title: 'Connect wallet',
    short: 'Approve in Nimiq Pay',
    detail: 'Connect the Nimiq wallet you\'ll use to sign this agreement.',
  },
  {
    id: 'sign',
    title: 'Sign agreement',
    short: 'Verify PDF + sign',
    detail: 'Choose the PDF the creator sent you on your computer, confirm it matches, then enter your name and sign.',
  },
  {
    id: 'done',
    title: 'All set',
    short: 'Sealed on Nimiq',
    detail: 'Once everyone has signed, the agreement is sealed on-chain automatically.',
  },
]

const ROLE_CHIPS: { id: WorkflowRole; label: string; path: string }[] = [
  { id: 'creator', label: 'Creator', path: 'Fingerprint locally → share → lock' },
  { id: 'signer', label: 'Signer(s)', path: 'Open link → sign' },
  { id: 'verifier', label: 'Verifier', path: 'Verify sealed PDFs' },
]

export type WorkflowRole = 'creator' | 'signer' | 'verifier' | 'unknown'

export function resolveRole(input: {
  hasWallet: boolean
  address: string | null
  activeDoc: SealDocument | null
  screen: AppScreen
}): WorkflowRole {
  if (input.screen === 'verify') return 'verifier'
  if (input.activeDoc && input.screen === 'document') {
    if (input.address && input.address === input.activeDoc.creatorAddress) return 'creator'
    return 'signer'
  }
  if (!input.activeDoc) return input.hasWallet ? 'creator' : 'unknown'
  if (input.address && input.address === input.activeDoc.creatorAddress) return 'creator'
  return 'unknown'
}

export function getStepsForRole(role: WorkflowRole): StepDef[] {
  if (role === 'signer') return SIGNER_STEPS
  if (role === 'verifier') return CREATOR_STEPS.filter(step => step.id === 'verify')
  return CREATOR_STEPS
}

function hasSignedDoc(doc: SealDocument, address: string): boolean {
  const wallet = normalizeAddress(address)
  return doc.signatures.some(sig => normalizeAddress(sig.signerAddress) === wallet)
}

function resolveSignerStep(input: {
  hasWallet: boolean
  address: string | null
  activeDoc: SealDocument | null
}): SignerStepId {
  const { hasWallet, address, activeDoc } = input
  if (!hasWallet) return 'connect'
  if (!activeDoc) return 'sign'
  if (activeDoc.status === 'locked') return 'done'
  if (address && hasSignedDoc(activeDoc, address)) return 'done'
  return 'sign'
}

function resolveCreatorStep(input: {
  hasWallet: boolean
  activeDoc: SealDocument | null
  screen: AppScreen
}): CreatorStepId {
  const { hasWallet, activeDoc, screen } = input

  if (screen === 'verify') return 'verify'
  if (!hasWallet) return 'connect'
  if (screen === 'create' || (!activeDoc && screen === 'home')) return 'create'
  if (!activeDoc) return 'create'
  if (activeDoc.status === 'locked') return 'verify'
  if (
    activeDoc.status === 'locking' ||
    activeDoc.status === 'ready_to_lock' ||
    activeDoc.signingProgress.readyToLock ||
    activeDoc.signingProgress.signed >= activeDoc.signingProgress.required
  ) {
    return 'lock'
  }
  if (activeDoc.signingProgress.signed > 0) return 'sign'
  return 'share'
}

export function resolveCurrentStep(input: {
  hasWallet: boolean
  activeDoc: SealDocument | null
  screen: AppScreen
  address?: string | null
}): WorkflowStepId {
  const role = resolveRole({
    hasWallet: input.hasWallet,
    address: input.address ?? null,
    activeDoc: input.activeDoc,
    screen: input.screen,
  })

  if (role === 'signer') {
    return resolveSignerStep({
      hasWallet: input.hasWallet,
      address: input.address ?? null,
      activeDoc: input.activeDoc,
    })
  }

  return resolveCreatorStep(input)
}

export function formatStepLabel(input: {
  role: WorkflowRole
  current: WorkflowStepId
  subtitle?: string
}): string {
  const steps = getStepsForRole(input.role)
  const index = steps.findIndex(step => step.id === input.current) + 1
  const step = steps.find(s => s.id === input.current)
  const prefix = index > 0 ? `Step ${index} of ${steps.length}` : ''
  if (!step) return input.subtitle ?? ''
  if (input.subtitle) return `${prefix} — ${input.subtitle}`
  return prefix ? `${prefix} — ${step.title}` : step.title
}

function stepState(
  stepId: WorkflowStepId,
  current: WorkflowStepId,
  steps: StepDef[],
): 'done' | 'current' | 'upcoming' {
  const order = steps.map(s => s.id)
  const stepIdx = order.indexOf(stepId)
  const currentIdx = order.indexOf(current)
  if (stepIdx < 0 || currentIdx < 0) return 'upcoming'
  if (stepIdx < currentIdx) return 'done'
  if (stepIdx === currentIdx) return 'current'
  return 'upcoming'
}

export function getWorkflowHint(input: {
  hasWallet: boolean
  address?: string | null
  activeDoc: SealDocument | null
  screen: AppScreen
}): string {
  const role = resolveRole({
    hasWallet: input.hasWallet,
    address: input.address ?? null,
    activeDoc: input.activeDoc,
    screen: input.screen,
  })
  const steps = getStepsForRole(role)
  const current = resolveCurrentStep(input)
  const step = steps.find(s => s.id === current) ?? CREATOR_STEPS[0]!
  const index = steps.findIndex(s => s.id === current) + 1

  if (role === 'signer') {
    if (current === 'connect') {
      return `Step ${index}: You were invited to sign "${input.activeDoc?.title ?? 'this agreement'}". Connect your wallet first.`
    }
    if (current === 'sign') {
      return `Step ${index}: Choose the PDF on your computer, confirm it matches, then sign.`
    }
    if (current === 'done' && input.activeDoc?.status === 'locked') {
      return 'Done! The agreement is sealed on-chain. Keep your PDF copy safe on your computer.'
    }
    if (current === 'done') {
      return `Step ${index}: You\'re signed. Waiting for ${input.activeDoc?.signingProgress.readyToLock ? 'on-chain sealing' : 'other signatures'}.`
    }
  }

  if (current === 'connect' && input.screen === 'document' && input.activeDoc) {
    return `Step ${index}: You were invited to sign "${input.activeDoc.title}". Connect your wallet first.`
  }
  if (current === 'connect') {
    return `Step ${index}: Connect your Nimiq wallet to unlock New agreement.`
  }
  if (current === 'create') {
    return `Step ${index}: Open New agreement and fingerprint your PDF locally — it never leaves your computer.`
  }
  if (current === 'share' && role === 'creator') {
    return `Step ${index}: Copy the share link and send the PDF file from your computer to the other party.`
  }
  if (current === 'sign') {
    const { signed, required } = input.activeDoc!.signingProgress
    return `Step ${index}: Verify your PDF locally, draw your signature, and submit (${signed}/${required} signed so far).`
  }
  if (current === 'lock') {
    return `Step ${index}: All signatures collected — approve the wallet prompt to seal on-chain.`
  }
  if (current === 'verify' && input.activeDoc?.status === 'locked') {
    return 'Done! Share the verification link or download the certificate. Your PDF stays on your device.'
  }
  if (current === 'verify') {
    return `Step ${index}: Fingerprint a PDF on your computer or enter a document ID to check it matches a sealed agreement.`
  }
  return `Step ${index}: ${step.title} — ${step.detail}`
}

function renderWorkflowHint(input: {
  hasWallet: boolean
  address?: string | null
  activeDoc: SealDocument | null
  screen: AppScreen
  onGoCreate?: () => void
}): ReactNode {
  const current = resolveCurrentStep(input)

  if (current === 'connect' && !input.hasWallet) {
    return (
      <>
        Connect your Nimiq wallet to unlock{' '}
        <TextLink onClick={input.onGoCreate} disabled={!input.onGoCreate} title="New agreement tab">
          New agreement
        </TextLink>
        .
      </>
    )
  }

  if (current === 'create') {
    if (input.screen === 'create') {
      return 'Choose a PDF on your computer — it never gets uploaded. You\'ll get a share link; send the file to other signers yourself.'
    }
    return (
      <>
        Open{' '}
        <TextLink onClick={input.onGoCreate} disabled={!input.onGoCreate} title="New agreement tab">
          New agreement
        </TextLink>
        {' '}
        and fingerprint your PDF locally — it never leaves your computer.
      </>
    )
  }

  return getWorkflowHint(input).replace(/^Step \d+: /, '')
}

interface WorkflowGuideProps {
  hasWallet: boolean
  address?: string | null
  activeDoc: SealDocument | null
  screen: AppScreen
  compact?: boolean
  onGoCreate?: () => void
  onConnect?: () => void
  walletConnecting?: boolean
  onStartOver?: () => void
  shareDoc?: SealDocument | null
  shareUrl?: string
  shareLinkCopied?: boolean
  onCopyShareLink?: () => void
}

export function WorkflowGuide({
  hasWallet,
  address,
  activeDoc,
  screen,
  compact,
  onGoCreate,
  onConnect,
  walletConnecting,
  onStartOver,
  shareDoc,
  shareUrl = '',
  shareLinkCopied,
  onCopyShareLink,
}: WorkflowGuideProps) {
  const role = resolveRole({ hasWallet, address: address ?? null, activeDoc, screen })
  const steps = getStepsForRole(role)
  const current = resolveCurrentStep({ hasWallet, activeDoc, screen, address })

  if (compact) {
    const step = steps.find(s => s.id === current) ?? steps[0]!
    const index = steps.findIndex(s => s.id === current) + 1
    const hint = renderWorkflowHint({ hasWallet, address, activeDoc, screen, onGoCreate })

    if (current === 'create' && screen === 'create') {
      return (
        <div className="workflow-next workflow-step-card">
          <p className="workflow-step-card-label">
            <span className="workflow-hint-step">Step {index} of {steps.length}</span>
            <strong>{step.title}</strong>
          </p>
          <p className="muted">{hint}</p>
        </div>
      )
    }

    return (
      <p className="workflow-hint">
        <span className="workflow-hint-step">Step {index} of {steps.length}</span>
        <strong>{step.title}</strong> — {hint}
      </p>
    )
  }

  const currentIndex = steps.findIndex(s => s.id === current)
  const intro =
    role === 'signer'
      ? 'Open link → sign → done'
      : role === 'verifier'
        ? 'Fingerprint locally to verify'
        : 'Local PDF → sign → seal on Nimiq'

  return (
    <div className="card workflow-card workflow-card--home">
      <div className="workflow-home-header">
        <h2 className="workflow-title">
          <Sparkles className="workflow-title-icon" size={18} strokeWidth={2.25} aria-hidden />
          How it works
        </h2>
        <p className="workflow-intro">{intro}</p>
      </div>

      <div className="workflow-now muted">
        <p>
          You&apos;re on <strong>step {currentIndex + 1}</strong> — {steps[currentIndex]?.title}
        </p>
        {current === 'verify' && onStartOver && (
          <button type="button" className="btn btn-secondary workflow-start-over" onClick={onStartOver}>
            <RotateCcw size={14} strokeWidth={2.25} aria-hidden />
            Start over
          </button>
        )}
      </div>

      {current === 'share' && shareDoc && shareUrl && onCopyShareLink && (
        <ShareInviteCard
          document={shareDoc}
          shareUrl={shareUrl}
          linkCopied={Boolean(shareLinkCopied)}
          onCopyLink={onCopyShareLink}
          embedded
        />
      )}

      <ol className="workflow-timeline" aria-label="Signing workflow">
        {steps.map((step, index) => {
          const state = stepState(step.id, current, steps)
          const isLast = index === steps.length - 1
          return (
            <li key={step.id} className={`workflow-timeline-item workflow-timeline-item--${state}`}>
              <div className="workflow-timeline-rail" aria-hidden>
                <span className="workflow-step-num">
                  {state === 'done' ? (
                    <Check size={14} strokeWidth={2.5} aria-hidden />
                  ) : (
                    index + 1
                  )}
                </span>
                {!isLast && <span className="workflow-timeline-line" />}
              </div>
              <div className="workflow-step-body">
                <div className="workflow-step-title-row">
                  <strong>{step.title}</strong>
                  {step.id === 'connect' && !hasWallet && onConnect && (
                    <button
                      type="button"
                      className={`btn btn-primary workflow-step-login${walletConnecting ? ' btn--busy' : ''}`}
                      onClick={onConnect}
                      disabled={walletConnecting}
                      aria-busy={walletConnecting}
                    >
                      {walletConnecting ? (
                        <>
                          <LoaderCircle className="btn-spinner" size={12} strokeWidth={2.5} aria-hidden />
                          Connecting…
                        </>
                      ) : (
                        'Log in'
                      )}
                    </button>
                  )}
                </div>
                <span className="muted">{step.short}</span>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="workflow-role-chips" aria-label="Quick paths by role">
        {ROLE_CHIPS.map(chip => (
          <div
            key={chip.id}
            className={`workflow-role-chip${role === chip.id ? ' workflow-role-chip--active' : ''}`}
          >
            <span className="workflow-role-chip-label">{chip.label}</span>
            <span className="workflow-role-chip-path">{chip.path}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function WorkflowProgress({
  current,
  role,
}: {
  current: WorkflowStepId
  role: WorkflowRole
}) {
  const steps = getStepsForRole(role)
  const currentIdx = steps.findIndex(s => s.id === current)
  return (
    <div className="workflow-progress" aria-label={`Step ${currentIdx + 1} of ${steps.length}`}>
      {steps.map((step, index) => {
        const state =
          index < currentIdx ? 'done' : index === currentIdx ? 'current' : 'upcoming'
        return (
          <div key={step.id} className={`workflow-progress-step workflow-progress-step--${state}`}>
            <span className="workflow-progress-dot" title={step.title}>
              {state === 'done' ? (
                <Check size={12} strokeWidth={2.5} aria-hidden />
              ) : (
                index + 1
              )}
            </span>
            <span className="workflow-progress-label">{step.title}</span>
          </div>
        )
      })}
    </div>
  )
}

interface WorkflowNextActionProps {
  hasWallet: boolean
  address?: string | null
  activeDoc: SealDocument | null
  screen: AppScreen
  walletConnecting?: boolean
  onConnect?: () => void
  onGoCreate?: () => void
}

export function WorkflowNextAction({
  hasWallet,
  address,
  activeDoc,
  screen,
  walletConnecting,
  onConnect,
  onGoCreate,
}: WorkflowNextActionProps) {
  const current = resolveCurrentStep({ hasWallet, activeDoc, screen, address })
  const role = resolveRole({ hasWallet, address: address ?? null, activeDoc, screen })

  let title = ''
  let body = ''
  let action: { label: string; onClick?: () => void } | null = null

  switch (current) {
    case 'connect':
      title = role === 'signer' ? 'You\'re invited to sign' : activeDoc ? 'You\'re invited to sign' : 'Start here'
      body =
        role === 'signer' || activeDoc
          ? `Connect your Nimiq wallet to sign "${activeDoc?.title ?? 'this agreement'}".`
          : 'Connect your Nimiq wallet before you can create or sign agreements.'
      action = onConnect ? { label: 'Connect wallet', onClick: onConnect } : null
      break
    case 'create':
      if (screen === 'create') return null
      title = 'Create your agreement'
      body = 'Choose a PDF on your computer — it never gets uploaded. You\'ll get a share link; send the file to other signers yourself.'
      action = onGoCreate ? { label: 'Go to New agreement', onClick: onGoCreate } : null
      break
    case 'share':
      title = 'Send the link'
      body =
        'Copy the share link and send the PDF file from your computer to the tenant or other signer. They verify the file locally when signing.'
      break
    case 'sign':
      title = role === 'signer' ? 'Sign this agreement' : 'Your turn to sign'
      body =
        role === 'signer'
          ? 'Choose the PDF on your computer, confirm it matches, then sign. The file never leaves your device.'
          : 'Verify your PDF locally, draw your signature, and tap Sign agreement. Your wallet confirms you agree to this exact fingerprint.'
      break
    case 'done':
      title = activeDoc?.status === 'locked' ? 'Agreement sealed' : 'You\'re all signed'
      body =
        activeDoc?.status === 'locked'
          ? 'Keep your PDF on your computer. Download the certificate or share the Verify link so anyone can check the fingerprint locally.'
          : activeDoc?.signingProgress.readyToLock
            ? 'Everyone has signed. The agreement will be sealed on-chain automatically — no further action needed from you.'
            : 'Thanks for signing. You\'ll be notified when the agreement is sealed on-chain.'
      break
    case 'lock':
      title = 'Ready to seal'
      body = `Everyone has signed. Approve the wallet prompt — VeriLock will submit the seal transaction (${formatSealFeeSummary()}) to record the fingerprint on-chain.`
      break
    case 'verify':
      title = activeDoc?.status === 'locked' ? 'Agreement sealed' : 'Check a document'
      body =
        activeDoc?.status === 'locked'
          ? 'Share the Verify link or download the certificate. Anyone can fingerprint their PDF locally to confirm it matches.'
          : 'Fingerprint a PDF on your computer or enter a document ID — no wallet required, file never uploaded.'
      break
  }

  if (!title) return null

  return (
    <div className="workflow-next">
      <div className="workflow-next-body">
        <strong>{title}</strong>
        <p className="muted">{body}</p>
      </div>
      {action?.onClick && (
        <button
          type="button"
          className={`btn btn-primary workflow-next-btn${walletConnecting ? ' btn--busy' : ''}`}
          onClick={action.onClick}
          disabled={walletConnecting}
          aria-busy={walletConnecting}
        >
          {walletConnecting ? (
            <>
              <LoaderCircle className="btn-spinner" size={16} strokeWidth={2.5} aria-hidden />
              Connecting…
            </>
          ) : (
            action.label
          )}
        </button>
      )}
    </div>
  )
}