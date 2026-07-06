import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const serverSrcDir = dirname(fileURLToPath(import.meta.url))
const serverDir = join(serverSrcDir, '..')
const projectRoot = join(serverDir, '..')

/** Persistent data root — mount a Railway volume at /data and set DATA_DIR=/data */
export function getDataDir(): string {
  if (process.env.DATA_DIR) return process.env.DATA_DIR
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH
  return join(serverDir, 'data')
}

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH ?? join(getDataDir(), 'verilock.db')
}

export function getDocsDir(): string {
  return process.env.DOCS_DIR ?? join(getDataDir(), 'docs')
}

export function getClientDistDir(): string {
  if (process.env.CLIENT_DIST_DIR) return process.env.CLIENT_DIST_DIR
  // Docker: WORKDIR is /app/server, client dist at /app/client/dist
  const dockerDist = join(serverDir, '..', 'client', 'dist')
  return dockerDist
}