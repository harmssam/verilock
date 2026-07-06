import type { NimiqProvider } from '@nimiq/mini-app-sdk'

interface NimiqPayHostContext {
  language?: string
  requestDeviceIdentifier?: (options: { reason: string }) => Promise<string>
}

declare global {
  interface Window {
    nimiq?: NimiqProvider
    nimiqPay?: NimiqPayHostContext
  }
}

export {}