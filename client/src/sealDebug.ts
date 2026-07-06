const PREFIX = '[verilock]'

function formatDetail(detail: unknown): unknown {
  if (detail instanceof Error) {
    return { name: detail.name, message: detail.message, stack: detail.stack }
  }
  return detail
}

export function sealLog(phase: string, detail?: unknown): void {
  if (detail === undefined) {
    console.log(PREFIX, phase)
    return
  }
  console.log(PREFIX, phase, formatDetail(detail))
}

export function sealWarn(phase: string, detail?: unknown): void {
  if (detail === undefined) {
    console.warn(PREFIX, phase)
    return
  }
  console.warn(PREFIX, phase, formatDetail(detail))
}

export function sealError(phase: string, err: unknown): void {
  console.error(PREFIX, phase, formatDetail(err))
}