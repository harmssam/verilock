import { purgeExpiredSessions } from './db.js'

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000

export function startSessionCleanup(): void {
  const run = () => {
    const removed = purgeExpiredSessions()
    if (removed > 0) {
      console.log(`[seal] purged ${removed} expired session(s)`)
    }
  }

  run()
  setInterval(run, CLEANUP_INTERVAL_MS)
}