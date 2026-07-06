const MAX_SIGNATURE_WIDTH = 480
const MAX_SIGNATURE_HEIGHT = 200

/** Resize and re-encode a drawn signature PNG for efficient server storage. */
export async function prepareSignatureImageUpload(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob)
  let width = bitmap.width
  let height = bitmap.height

  if (width > MAX_SIGNATURE_WIDTH) {
    height = Math.round((height * MAX_SIGNATURE_WIDTH) / width)
    width = MAX_SIGNATURE_WIDTH
  }
  if (height > MAX_SIGNATURE_HEIGHT) {
    width = Math.round((width * MAX_SIGNATURE_HEIGHT) / height)
    height = MAX_SIGNATURE_HEIGHT
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

  const compressed = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      result => (result ? resolve(result) : reject(new Error('Failed to encode signature image'))),
      'image/png',
    )
  })

  const bytes = new Uint8Array(await compressed.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}