export const PLAYER_NAME_MAX = 50
export const PLAYER_NAME_REGEX = /^[a-zA-Z0-9\s.,'+\-_&()]+$/

export function validatePlayerName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { valid: true }
  if (trimmed.length > PLAYER_NAME_MAX) {
    return { valid: false, error: `Name must be ${PLAYER_NAME_MAX} characters or less` }
  }
  if (!PLAYER_NAME_REGEX.test(trimmed)) {
    return { valid: false, error: 'Name can only contain letters, numbers, spaces, and basic punctuation' }
  }
  return { valid: true }
}

export const NOTE_MAX = 200
export function validateNote(note: string): { valid: boolean; error?: string } {
  if (note.length > NOTE_MAX) {
    return { valid: false, error: `Note must be ${NOTE_MAX} characters or less` }
  }
  return { valid: true }
}

export const TABLE_NAME_MAX = 30
export const TABLE_NAME_REGEX = /^[a-zA-Z0-9\s.\-_]+$/
export function validateTableName(name: string): { valid: boolean; error?: string } {
  const trimmed = name.trim()
  if (trimmed.length === 0) return { valid: false, error: 'Name is required' }
  if (trimmed.length > TABLE_NAME_MAX) {
    return { valid: false, error: `Name must be ${TABLE_NAME_MAX} characters or less` }
  }
  if (!TABLE_NAME_REGEX.test(trimmed)) {
    return { valid: false, error: 'Name can only contain letters, numbers, spaces, dots, dashes, underscores' }
  }
  return { valid: true }
}

export function validateUpiId(upi: string): string | null {
  const trimmed = upi.trim()
  if (!trimmed) return null // empty is valid (optional field)
  // UPI handle format: <handle>@<provider>
  // Handle: 2-256 chars alphanumeric, dot, hyphen, underscore
  // Provider: 2-64 chars alphabetic (axl, okhdfcbank, paytm, ybl, ibl, oksbi, etc.)
  if (!/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/.test(trimmed)) {
    return 'Looks invalid. Example: 7758969291@axl'
  }
  return null
}

export function validateItemName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Item name is required'
  if (trimmed.length > 50) return 'Max 50 characters'
  if (!/^[\p{L}\p{N} .\-_+]+$/u.test(trimmed)) return 'Only letters, numbers, spaces, . - _ +'
  return null
}
