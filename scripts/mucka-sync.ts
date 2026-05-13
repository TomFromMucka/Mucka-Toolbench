#!/usr/bin/env tsx
/**
 * Create-or-update the Mucka Workstation PM agent on ElevenLabs.
 *
 *   npm run mucka:sync          # create if MUCKA_AGENT_ID missing, else update
 *   npm run mucka:sync -- --dry-run  # show diff vs live agent, write nothing
 *
 * Env vars (see CLAUDE.md):
 *   ELEVENLABS_API_KEY            required
 *   ELEVENLABS_MUCKA_VOICE_ID     required on create; used to set/update voice
 *   MUCKA_AGENT_ID                optional — if present, update; else create
 *                                 and print the new id for you to add to env
 *
 * The exact path to the prompt inside conversation_config has been renamed
 * in the dashboard before, so on every run we GET the agent first, log the
 * current shape under verbose mode, and PATCH the smallest possible
 * subtree.
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ELEVENLABS_BASE = 'https://api.elevenlabs.io'
const PROMPT_PATH = resolve('src/main/mucka/prompts/pm.md')
const AGENT_NAME = 'Mucka — Workstation PM'

interface CliFlags {
  dryRun: boolean
  verbose: boolean
}

function parseFlags(argv: string[]): CliFlags {
  return {
    dryRun: argv.includes('--dry-run'),
    verbose: argv.includes('--verbose') || argv.includes('-v')
  }
}

function readEnv(): { apiKey: string; agentId: string | null; voiceId: string | null } {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim()
  if (!apiKey) {
    console.error('ELEVENLABS_API_KEY is not set')
    process.exit(1)
  }
  return {
    apiKey,
    agentId: process.env.MUCKA_AGENT_ID?.trim() || null,
    voiceId: process.env.ELEVENLABS_MUCKA_VOICE_ID?.trim() || null
  }
}

async function api<T = unknown>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${ELEVENLABS_BASE}${path}`, {
    method,
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} → ${res.status}: ${text || res.statusText}`)
  }
  return (await res.json()) as T
}

function readPrompt(): string {
  return readFileSync(PROMPT_PATH, 'utf8').trim()
}

function diff(localPrompt: string, livePrompt: string): void {
  if (localPrompt === livePrompt) {
    console.log('Prompt is in sync — nothing to do.')
    return
  }
  console.log('--- live (remote)')
  console.log(livePrompt)
  console.log('+++ local (pm.md)')
  console.log(localPrompt)
}

function extractLivePrompt(agent: Record<string, unknown>): string {
  // The path has been renamed in the dashboard before — be defensive.
  const cfg = (agent.conversation_config as Record<string, unknown>) ?? {}
  const agentBlock = (cfg.agent as Record<string, unknown>) ?? {}
  const promptBlock = (agentBlock.prompt as Record<string, unknown>) ?? {}
  return typeof promptBlock.prompt === 'string' ? promptBlock.prompt : ''
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const env = readEnv()
  const localPrompt = readPrompt()

  if (!env.agentId) {
    if (flags.dryRun) {
      console.log(
        'MUCKA_AGENT_ID is not set — would create a new agent. Re-run without --dry-run to actually create.'
      )
      console.log(`\nWill create agent "${AGENT_NAME}" with:`)
      console.log(`  voice_id: ${env.voiceId ?? '(not set — required to create)'}`)
      console.log(`  prompt (${localPrompt.length} chars):`)
      console.log(localPrompt.split('\n').slice(0, 10).join('\n'))
      console.log('  …')
      return
    }
    if (!env.voiceId) {
      console.error(
        'ELEVENLABS_MUCKA_VOICE_ID is required to create a new agent. Set it and rerun.'
      )
      process.exit(1)
    }
    console.log(`Creating new agent "${AGENT_NAME}"…`)
    const created = await api<{ agent_id: string }>(env.apiKey, 'POST', '/v1/convai/agents/create', {
      name: AGENT_NAME,
      conversation_config: {
        agent: {
          prompt: { prompt: localPrompt },
          first_message: 'Mucka, ready.',
          language: 'en'
        },
        tts: {
          voice_id: env.voiceId
        }
      }
    })
    console.log(`\n✓ Created. Add this to your env:\n`)
    console.log(`  MUCKA_AGENT_ID=${created.agent_id}\n`)
    return
  }

  const liveAgent = await api<Record<string, unknown>>(
    env.apiKey,
    'GET',
    `/v1/convai/agents/${env.agentId}`
  )
  const livePrompt = extractLivePrompt(liveAgent)

  if (flags.verbose) {
    console.log('— live conversation_config —')
    console.log(JSON.stringify(liveAgent.conversation_config, null, 2))
    console.log()
  }

  if (flags.dryRun) {
    diff(localPrompt, livePrompt)
    return
  }

  if (localPrompt === livePrompt && !env.voiceId) {
    console.log('Prompt unchanged and no voice override — nothing to do.')
    return
  }

  const patch: Record<string, unknown> = {
    conversation_config: {
      agent: {
        prompt: { prompt: localPrompt }
      },
      ...(env.voiceId ? { tts: { voice_id: env.voiceId } } : {})
    }
  }

  await api(env.apiKey, 'PATCH', `/v1/convai/agents/${env.agentId}`, patch)
  console.log(`✓ Updated agent ${env.agentId}.`)
  if (localPrompt !== livePrompt) {
    console.log(`  prompt: ${livePrompt.length} → ${localPrompt.length} chars`)
  }
  if (env.voiceId) console.log(`  voice_id: ${env.voiceId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
