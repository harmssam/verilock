/**
 * Content studios (Blog Studio + X Post Studio) moved out of this monorepo.
 *
 * Repo: https://github.com/clevertech-os/content-studio
 * Local path (typical): ../content-studio
 *
 *   cd ../content-studio && npm install && npm run dev
 *   # set CONTENT_ROOT to this verilock checkout if not auto-detected
 *
 * This hook remains so production never tries to load studio modules.
 */
import type { Express } from 'express'

export async function attachLocalStudios(_app: Express): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  local studios: off (production)')
    return
  }
  console.log(
    '  local studios: moved → clevertech-os/content-studio (run that repo separately)',
  )
}
