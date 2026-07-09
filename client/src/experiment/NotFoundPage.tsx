import { FileQuestion } from 'lucide-react'

interface NotFoundPageProps {
  title?: string
  message?: string
  /** Optional path shown for debugging (e.g. /d/badslug). */
  path?: string | null
  onHome: () => void
}

/**
 * In-app invalid URL / missing agreement page (SPA catch-all + deep-link 404).
 */
export function NotFoundPage({
  title = 'This link is not valid',
  message = 'That page does not exist on VeriLock, or the agreement could not be found. Check the URL or go home to start again.',
  path,
  onHome,
}: NotFoundPageProps) {
  return (
    <section className="not-found-page card" aria-labelledby="not-found-title">
      <div className="not-found-icon" aria-hidden>
        <FileQuestion size={28} strokeWidth={1.75} />
      </div>
      <h2 id="not-found-title">{title}</h2>
      <p className="muted not-found-message">{message}</p>
      {path ? (
        <p className="not-found-path muted">
          <code className="mono">{path}</code>
        </p>
      ) : null}
      <button type="button" className="btn btn-primary" onClick={onHome}>
        Back to home
      </button>
    </section>
  )
}
