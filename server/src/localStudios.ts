/**
 * Optional local content studios (Blog Studio, X Post Studio).
 * Module files are gitignored — production and clean checkouts skip them.
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Express } from 'express'

const srcDir = dirname(fileURLToPath(import.meta.url))

function studioSourcePresent(baseName: string): boolean {
  return (
    existsSync(join(srcDir, `${baseName}.ts`)) || existsSync(join(srcDir, `${baseName}.js`))
  )
}

export async function attachLocalStudios(app: Express): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('  local studios: off (production)')
    return
  }

  if (studioSourcePresent('blogStudioRoutes')) {
    try {
      const mod = await import('./blogStudioRoutes.js')
      mod.attachBlogStudio(app)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('  blog studio: failed to load —', message)
    }
  } else {
    console.log('  blog studio: not present (local-only gitignored module)')
  }

  if (studioSourcePresent('xPostStudioRoutes')) {
    try {
      const mod = await import('./xPostStudioRoutes.js')
      mod.attachXPostStudio(app)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('  x-post studio: failed to load —', message)
    }
  } else {
    console.log('  x-post studio: not present (local-only gitignored module)')
  }
}
