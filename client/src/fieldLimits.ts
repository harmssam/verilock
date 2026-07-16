/** Keep in sync with server/src/security.ts field limits. */

export const MAX_TITLE_LENGTH = 120
export const MAX_DISPLAY_NAME_LENGTH = 48
export const MAX_DOCUMENT_NOTES_LENGTH = 256
export const MAX_RENTAL_FIELD_LENGTH = 120

/** Support contact form — keep in sync with server/src/supportContact.ts */
export const MAX_SUPPORT_NAME_LENGTH = 80
export const MAX_SUPPORT_EMAIL_LENGTH = 254
export const MAX_SUPPORT_SUBJECT_LENGTH = 120
export const MAX_SUPPORT_MESSAGE_LENGTH = 4000

export function clampField(value: string, maxLength: number): string {
  return value.slice(0, maxLength)
}