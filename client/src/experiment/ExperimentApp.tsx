import { useState } from 'react'
import { AccountMenu } from './AccountMenu'
import { DocumentJourney } from './DocumentJourney'
import { demoAddress, type DemoAccount } from './types'

export function ExperimentApp() {
  const [account, setAccount] = useState<DemoAccount | null>(null)
  const [connecting, setConnecting] = useState(false)

  const connect = async () => {
    setConnecting(true)
    await new Promise(r => setTimeout(r, 750))
    setAccount(demoAddress())
    setConnecting(false)
  }

  const disconnect = () => {
    setAccount(null)
  }

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
            <p>Journey experiment</p>
          </div>
        </div>

        <div className="exp-header-actions">
          <a className="exp-back" href="/">
            Production
          </a>
          <AccountMenu
            account={account}
            connecting={connecting}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
          />
        </div>
      </header>

      <p className="exp-banner" role="note">
        <strong>Sandbox</strong> — demo wallet &amp; local state only. UI playground, not the live
        app.
      </p>

      <DocumentJourney
        account={account}
        connecting={connecting}
        onConnect={() => void connect()}
        onDisconnect={disconnect}
      />

      <footer className="exp-footer">
        <p className="muted">
          Experiment entry <code>experiment.html</code> · promote later by wiring real APIs into{' '}
          <code>DocumentJourney</code>
        </p>
      </footer>
    </div>
  )
}
