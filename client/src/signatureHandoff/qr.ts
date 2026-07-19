import QRCode from 'qrcode'

/** QR as SVG data URL for the desktop handoff modal. */
export async function qrDataUrl(text: string, size = 220): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: size,
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}
