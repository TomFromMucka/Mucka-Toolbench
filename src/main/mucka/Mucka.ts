import type { MuckaStatus } from '@shared/types'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'

export interface MuckaEnv {
  apiKey: string | undefined
  agentId: string | undefined
  voiceId: string | undefined
}

export function readEnv(): MuckaEnv {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() || undefined,
    agentId: process.env.MUCKA_AGENT_ID?.trim() || undefined,
    voiceId: process.env.ELEVENLABS_MUCKA_VOICE_ID?.trim() || undefined
  }
}

export function getStatus(): MuckaStatus {
  const env = readEnv()
  if (!env.apiKey) return { kind: 'missing-key' }
  if (!env.agentId) return { kind: 'missing-agent' }
  return { kind: 'ok' }
}

/**
 * Mint a short-lived signed URL the renderer uses to open a conversation
 * WebSocket without ever seeing the API key.
 */
export async function mintSignedUrl(): Promise<string> {
  const env = readEnv()
  if (!env.apiKey) throw new Error('ELEVENLABS_API_KEY is not set')
  if (!env.agentId) throw new Error('MUCKA_AGENT_ID is not set')

  const url = new URL('/v1/convai/conversation/get-signed-url', ELEVENLABS_BASE)
  url.searchParams.set('agent_id', env.agentId)

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'xi-api-key': env.apiKey }
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `ElevenLabs signed-url failed (${res.status}): ${body || res.statusText}`
    )
  }

  const data = (await res.json()) as { signed_url?: string }
  if (!data.signed_url) {
    throw new Error('ElevenLabs signed-url response missing signed_url')
  }
  return data.signed_url
}
