import { purgeExpiredSessions, purgeExpiredSigHandoffs } from './db.js'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export function startSessionCleanup(): void {
  const run = () => {
    const removed = purgeExpiredSessions()
    if (removed > 0) {
      console.log(`[seal] purged ${removed} expired session(s)`)
    }
    const handoffs = purgeExpiredSigHandoffs()
    if (handoffs > 0) {
      console.log(`[seal] purged ${handoffs} expired sig-handoff room(s)`)
    }
  }

  run()
  setInterval(run, CLEANUP_INTERVAL_MS)
}