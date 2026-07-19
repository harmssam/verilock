/** Resize signature PNG for handoff (matches server-friendly dimensions). */

const MAX_W = 480
const MAX_H = 200

export async function resizeSignaturePng(blob: Blob): Promise<{
  blob: Blob
  width: number
  height: number
}> {
  const bitmap = await createImageBitmap(blob)
  let width = bitmap.width
  let height = bitmap.height

  if (width > MAX_W) {
    height = Math.round((height * MAX_W) / width)
    width = MAX_W
  }
  if (height > MAX_H) {
    width = Math.round((width * MAX_H) / height)
    height = MAX_H
  }

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    throw new Error('Could not prepare signature image')
  }
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const out = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      r => (r ? resolve(r) : reject(new Error('Failed to encode signature'))),
      'image/png',
    )
  })
  return { blob: out, width: canvas.width, height: canvas.height }
}
