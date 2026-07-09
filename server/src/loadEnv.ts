import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Load KEY=VALUE pairs from server/.env into process.env (does not override
 * variables already set by the host / Railway).
 */
export function loadEnvFile(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    join(here, '../.env'),
    join(process.cwd(), '.env'),
    join(process.cwd(), 'server/.env'),
  ]

  for (const path of candidates) {
    if (!existsSync(path)) continue
    try {
      const text = readFileSync(path, 'utf8')
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim()
        if (!line || line.startsWith('#')) continue
        const eq = line.indexOf('=')
        if (eq <= 0) continue
        const key = line.slice(0, eq).trim()
        let value = line.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (key && process.env[key] === undefined) {
          process.env[key] = value
        }
      }
      return
    } catch {
      /* try next path */
    }
  }
}
