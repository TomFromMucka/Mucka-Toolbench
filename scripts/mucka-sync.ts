#!/usr/bin/env tsx
/**
 * Create-or-update the Mucka Workstation PM agent on ElevenLabs.
 *
 *   npm run mucka:sync                 # create-or-update; pushes prompt + tools
 *   npm run mucka:sync -- --dry-run    # diff vs live agent, write nothing
 *   npm run mucka:sync -- --verbose    # also log the live conversation_config
 *
 * Env vars (see CLAUDE.md):
 *   ELEVENLABS_API_KEY            required
 *   ELEVENLABS_MUCKA_VOICE_ID     required on create; used to set/update voice
 *   MUCKA_AGENT_ID                optional — if present, update; else create
 *                                 and print the new id for you to add to env
 *
 * Tool schemas are imported from src/shared/mucka-tools.ts so the renderer
 * handlers and the dashboard declarations stay in lockstep (matching by
 * tool name, case-sensitive).
 */

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TOOL_DEFINITIONS } from '../src/shared/mucka-tools.js'

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

function buildToolSchemas(): Array<Record<string, unknown>> {
  return TOOL_DEFINITIONS.map((t) => ({
    type: 'client',
    name: t.name,
    description: t.description,
    expects_response: true,
    response_timeout_secs: 20,
    parameters: t.parameters
  }))
}

function diff(local: string, live: string, label: string): void {
  if (local === live) {
    console.log(`${label}: in sync`)
    return
  }
  console.log(`--- live ${label}`)
  console.log(live)
  console.log(`+++ local ${label}`)
  console.log(local)
}

function extractLivePrompt(agent: Record<string, unknown>): string {
  const cfg = (agent.conversation_config as Record<string, unknown>) ?? {}
  const agentBlock = (cfg.agent as Record<string, unknown>) ?? {}
  const promptBlock = (agentBlock.prompt as Record<string, unknown>) ?? {}
  return typeof promptBlock.prompt === 'string' ? promptBlock.prompt : ''
}

function extractLiveTools(agent: Record<string, unknown>): unknown[] {
  const cfg = (agent.conversation_config as Record<string, unknown>) ?? {}
  const agentBlock = (cfg.agent as Record<string, unknown>) ?? {}
  const promptBlock = (agentBlock.prompt as Record<string, unknown>) ?? {}
  const tools = promptBlock.tools
  return Array.isArray(tools) ? tools : []
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const env = readEnv()
  const localPrompt = readPrompt()
  const localTools = buildToolSchemas()

  if (!env.agentId) {
    if (flags.dryRun) {
      console.log(
        'MUCKA_AGENT_ID is not set — would create a new agent. Re-run without --dry-run to actually create.'
      )
      console.log(`\nWill create agent "${AGENT_NAME}" with:`)
      console.log(`  voice_id: ${env.voiceId ?? '(not set — required to create)'}`)
      console.log(`  prompt: ${localPrompt.length} chars`)
      console.log(`  tools: ${localTools.map((t) => (t as { name: string }).name).join(', ')}`)
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
          prompt: { prompt: localPrompt, tools: localTools },
          first_message: 'Mucka, ready.',
          language: 'en'
        },
        tts: {
          voice_id: env.voiceId
        }
      }
    })
    console.log(`\n✓ Created. Add this to your .env:\n`)
    console.log(`  MUCKA_AGENT_ID=${created.agent_id}\n`)
    return
  }

  const liveAgent = await api<Record<string, unknown>>(
    env.apiKey,
    'GET',
    `/v1/convai/agents/${env.agentId}`
  )
  const livePrompt = extractLivePrompt(liveAgent)
  const liveTools = extractLiveTools(liveAgent)
  const liveToolsJson = JSON.stringify(liveTools, null, 2)
  const localToolsJson = JSON.stringify(localTools, null, 2)

  if (flags.verbose) {
    console.log('— live conversation_config —')
    console.log(JSON.stringify(liveAgent.conversation_config, null, 2))
    console.log()
  }

  if (flags.dryRun) {
    diff(localPrompt, livePrompt, 'prompt')
    diff(localToolsJson, liveToolsJson, 'tools')
    return
  }

  const promptChanged = localPrompt !== livePrompt
  const toolsChanged = localToolsJson !== liveToolsJson

  if (!promptChanged && !toolsChanged && !env.voiceId) {
    console.log('Prompt + tools unchanged. Nothing to do.')
    return
  }

  const patch: Record<string, unknown> = {
    conversation_config: {
      agent: {
        prompt: {
          prompt: localPrompt,
          tools: localTools
        }
      },
      ...(env.voiceId ? { tts: { voice_id: env.voiceId } } : {})
    }
  }

  await api(env.apiKey, 'PATCH', `/v1/convai/agents/${env.agentId}`, patch)
  console.log(`✓ Updated agent ${env.agentId}.`)
  if (promptChanged) {
    console.log(`  prompt: ${livePrompt.length} → ${localPrompt.length} chars`)
  }
  if (toolsChanged) {
    console.log(
      `  tools: ${liveTools.length} → ${localTools.length} (${localTools.map((t) => (t as { name: string }).name).join(', ')})`
    )
  }
  if (env.voiceId) console.log(`  voice_id: ${env.voiceId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
