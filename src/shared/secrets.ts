/**
 * Cross-process types for the credential store.
 *
 * Each known integration credential is declared here with metadata the
 * Settings UI needs (label, hint, whether to mask in the input, whether
 * a connection-test endpoint exists). The main process encrypts values
 * via Electron's safeStorage (macOS Keychain / Windows DPAPI / libsecret
 * on Linux) and persists them to `<userData>/secrets.enc.json`.
 *
 * Stored values are decrypted into `process.env.<envName>` at boot so
 * existing modules (Vercel, GitHub, ElevenLabs, the Agent SDK Claude
 * path) keep reading from env without code changes. `.env` files still
 * work as a fallback for users who prefer them.
 */

export type SecretId =
  | 'ELEVENLABS_API_KEY'
  | 'ELEVENLABS_MUCKA_VOICE_ID'
  | 'MUCKA_AGENT_ID'
  | 'GITHUB_TOKEN'
  | 'VERCEL_API_TOKEN'
  | 'VERCEL_TEAM_ID'

export type SecretCategory = 'elevenlabs' | 'github' | 'vercel'

export interface SecretDef {
  id: SecretId
  /** Env variable name written into process.env on boot. */
  envName: string
  /** Display name in the Settings UI. */
  label: string
  /** Optional help text shown under the input. */
  hint?: string
  category: SecretCategory
  /** Required for the feature to work at all. UI surfaces a soft warning. */
  required: boolean
  /** Mask the value in the input box (passwords yes, voice IDs no). */
  secret: boolean
  /** A connection-test endpoint exists for this key. */
  testable: boolean
}

export const SECRET_DEFS: readonly SecretDef[] = [
  {
    id: 'ELEVENLABS_API_KEY',
    envName: 'ELEVENLABS_API_KEY',
    label: 'API key',
    hint: 'Settings → API Keys in your ElevenLabs dashboard.',
    category: 'elevenlabs',
    required: true,
    secret: true,
    testable: true
  },
  {
    id: 'ELEVENLABS_MUCKA_VOICE_ID',
    envName: 'ELEVENLABS_MUCKA_VOICE_ID',
    label: 'Voice ID',
    hint: 'From a voice in your ElevenLabs Voice Library.',
    category: 'elevenlabs',
    required: false,
    secret: false,
    testable: false
  },
  {
    id: 'MUCKA_AGENT_ID',
    envName: 'MUCKA_AGENT_ID',
    label: 'Conv AI agent ID',
    hint: 'Created automatically the first time you run `npm run mucka:sync`.',
    category: 'elevenlabs',
    required: false,
    secret: false,
    testable: false
  },
  {
    id: 'GITHUB_TOKEN',
    envName: 'GITHUB_TOKEN',
    label: 'Personal access token',
    hint: 'Fine-grained PAT with Contents: Read for the repos you want the PR + check-runs panel to see.',
    category: 'github',
    required: false,
    secret: true,
    testable: true
  },
  {
    id: 'VERCEL_API_TOKEN',
    envName: 'VERCEL_API_TOKEN',
    label: 'API token',
    hint: 'Account settings → Tokens.',
    category: 'vercel',
    required: false,
    secret: true,
    testable: true
  },
  {
    id: 'VERCEL_TEAM_ID',
    envName: 'VERCEL_TEAM_ID',
    label: 'Team ID',
    hint: 'Optional — only if your projects belong to a Vercel team and the team id is not in .vercel/project.json.',
    category: 'vercel',
    required: false,
    secret: false,
    testable: false
  }
] as const

export interface SecretStatus {
  id: SecretId
  /** Whether a non-empty value is available (from store or env). */
  set: boolean
  /** Where the current value came from. */
  source: 'store' | 'env' | 'none'
  /** Last 4 chars when `set`; null otherwise. UI uses for masked display. */
  last4: string | null
}

export type SecretTestResult =
  | { ok: true; detail?: string }
  | { ok: false; reason: string }
