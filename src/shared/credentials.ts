/**
 * Cross-process types for the credentials library — the user's saved
 * site logins, right-clickable into preview-pane iframes.
 *
 * Stored in `<userData>/credentials.enc.json`. Labels are plaintext
 * (they show in menus + Settings); username and password are encrypted
 * together as one blob per entry via Electron's safeStorage.
 */

export interface CredentialEntry {
  id: string
  /** Display name. e.g. "Mucka prod admin". */
  label: string
  /** Email or username — first field inserted. */
  username: string
  /** Password — second field inserted. Decrypted only on demand. */
  password: string
  /** ms timestamp. */
  createdAt: number
  /** ms timestamp; bumped on edit. */
  updatedAt: number
}

/** Public-safe view used by the renderer — no plaintext password. */
export interface CredentialSummary {
  id: string
  label: string
  username: string
  /** Last 4 chars of the password for visual reassurance. */
  passwordLast4: string
  createdAt: number
  updatedAt: number
}

export interface CredentialCreateInput {
  label: string
  username: string
  password: string
}

export interface CredentialUpdateInput {
  id: string
  label?: string
  username?: string
  /** Pass to change; omit to keep existing. */
  password?: string
}
