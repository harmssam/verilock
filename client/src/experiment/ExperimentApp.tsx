import { InteractiveWorkflow } from './InteractiveWorkflow'

export function ExperimentApp() {
  return (
    <div className="exp-app">
      <header className="exp-header">
        <div className="exp-brand">
          <img
            className="exp-brand-mark"
            src="/verilock-mark.png"
            alt=""
            width={56}
            height={56}
          />
          <div className="exp-brand-text">
            <h1>VeriLock</h1>
            <p>Experiment · interactive workflow</p>
          </div>
        </div>
        <a className="exp-back" href="/">
          ← Production app
        </a>
      </header>

      <p className="exp-banner" role="note">
        Sandbox UI only — not wired to wallet or API. Safe to click through.
      </p>

      <InteractiveWorkflow />

      <footer className="exp-footer">
        <p className="muted">
          Parallel entry: <code>experiment.html</code> · styles live under{' '}
          <code>src/experiment/</code>
        </p>
      </footer>
    </div>
  )
}
