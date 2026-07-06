import { BufferUtils, Hash, PublicKey, Signature } from '@nimiq/core'

/** Same prefix used by @nimiq/hub-api signMessage(). */
const MSG_PREFIX = '\x16Nimiq Signed Message:\n'

export function verifyHubSignedMessage(
  message: string,
  publicKeyHex: string,
  signatureHex: string,
): boolean {
  const data = MSG_PREFIX + message.length + message
  const dataBytes = BufferUtils.fromUtf8(data)
  const hash = Hash.computeSha256(dataBytes)
  const publicKey = PublicKey.fromHex(publicKeyHex)
  const signature = Signature.fromHex(signatureHex)
  return publicKey.verify(signature, hash)
}