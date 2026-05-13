#!/usr/bin/env tsx
/**
 * Create-or-update the Mucka Workstation PM agent on ElevenLabs.
 *
 *   npm run mucka:sync                 # create-or-update; pushes prompt + tools
 *   npm run mucka:sync -- --dry-run    # diff vs live agent, write nothing
 *   npm run mucka:sync -- --verbose    # also log the live conversation_config
 *
 * Tools are platform-level (workspace-scoped) on ElevenLabs and the agent
 * just holds a `tool_ids` list — inline tools on the agent's prompt are
 * silently ignored. We ensure each of our TOOL_DEFINITIONS exists at
 * /v1/convai/tools (POST or PATCH by name), then PATCH the agent's
 * conversation_config.agent.prompt.tool_ids to point at them.
 *
 * Env vars (see CLAUDE.md):
 *   ELEVENLABS_API_KEY            required
 *   ELEVENLABS_MUCKA_VOICE_ID     required on create; used to set/update voice
 *   MUCKA_AGENT_ID                optional — if present, update; else create
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

function buildToolConfig(def: (typeof TOOL_DEFINITIONS)[number]): Record<string, unknown> {
  return {
    type: 'client',
    name: def.name,
    description: def.description,
    expects_response: true,
    response_timeout_secs: 20,
    parameters: def.parameters
  }
}

interface PlatformTool {
  id: string
  tool_config: { name: string; description?: string }
}

interface ToolsListResponse {
  tools?: PlatformTool[]
}

async function listPlatformTools(apiKey: string): Promise<PlatformTool[]> {
  const res = await api<ToolsListResponse>(apiKey, 'GET', '/v1/convai/tools')
  return Array.isArray(res.tools) ? res.tools : []
}

async function ensureTool(
  apiKey: string,
  def: (typeof TOOL_DEFINITIONS)[number],
  existing: PlatformTool[]
): Promise<{ id: string; action: 'created' | 'updated' | 'unchanged' }> {
  const tool_config = buildToolConfig(def)
  const match = existing.find((t) => t.tool_config?.name === def.name)
  if (!match) {
    const created = await api<{ id: string }>(apiKey, 'POST', '/v1/convai/tools', {
      tool_config
    })
    return { id: created.id, action: 'created' }
  }
  // Update in place — descriptions/params may have changed.
  await api(apiKey, 'PATCH', `/v1/convai/tools/${match.id}`, { tool_config })
  return { id: match.id, action: 'updated' }
}

function extractLivePrompt(agent: Record<string, unknown>): string {
  const cfg = (agent.conversation_config as Record<string, unknown>) ?? {}
  const agentBlock = (cfg.agent as Record<string, unknown>) ?? {}
  const promptBlock = (agentBlock.prompt as Record<string, unknown>) ?? {}
  return typeof promptBlock.prompt === 'string' ? promptBlock.prompt : ''
}

function extractLiveToolIds(agent: Record<string, unknown>): string[] {
  const cfg = (agent.conversation_config as Record<string, unknown>) ?? {}
  const agentBlock = (cfg.agent as Record<string, unknown>) ?? {}
  const promptBlock = (agentBlock.prompt as Record<string, unknown>) ?? {}
  const ids = promptBlock.tool_ids
  return Array.isArray(ids) ? ids.filter((s): s is string => typeof s === 'string') : []
}

async function syncTools(
  apiKey: string,
  flags: CliFlags
): Promise<{ ids: string[]; summary: string }> {
  if (flags.dryRun) {
    return {
      ids: [],
      summary: TOOL_DEFINITIONS.map((t) => t.name).join(', ')
    }
  }
  const existing = await listPlatformTools(apiKey)
  const ids: string[] = []
  const counts = { created: 0, updated: 0, unchanged: 0 }
  for (const def of TOOL_DEFINITIONS) {
    const { id, action } = await ensureTool(apiKey, def, existing)
    ids.push(id)
    counts[action]++
  }
  const summary = `${TOOL_DEFINITIONS.length} tools — ${counts.created} created, ${counts.updated} updated`
  return { ids, summary }
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2))
  const env = readEnv()
  const localPrompt = readPrompt()

  if (!env.agentId) {
    if (flags.dryRun) {
      console.log('MUCKA_AGENT_ID is not set — would create a new agent.')
      console.log(`\nWill create "${AGENT_NAME}" with:`)
      console.log(`  voice_id: ${env.voiceId ?? '(not set — required to create)'}`)
      console.log(`  prompt:   ${localPrompt.length} chars`)
      console.log(`  tools:    ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}`)
      return
    }
    if (!env.voiceId) {
      console.error(
        'ELEVENLABS_MUCKA_VOICE_ID is required to create a new agent. Set it and rerun.'
      )
      process.exit(1)
    }

    console.log('Syncing platform tools…')
    const { ids: toolIds, summary } = await syncTools(env.apiKey, flags)
    console.log(`  ${summary}`)

    console.log(`\nCreating new agent "${AGENT_NAME}"…`)
    const created = await api<{ agent_id: string }>(env.apiKey, 'POST', '/v1/convai/agents/create', {
      name: AGENT_NAME,
      conversation_config: {
        agent: {
          prompt: { prompt: localPrompt, tool_ids: toolIds },
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
  const liveToolIds = extractLiveToolIds(liveAgent)

  if (flags.verbose) {
    console.log('— live conversation_config —')
    console.log(JSON.stringify(liveAgent.conversation_config, null, 2))
    console.log()
  }

  if (flags.dryRun) {
    if (localPrompt === livePrompt) {
      console.log('prompt: in sync')
    } else {
      console.log(`prompt: ${livePrompt.length} → ${localPrompt.length} chars (will update)`)
    }
    console.log(
      `tools: ${liveToolIds.length} bound, would sync ${TOOL_DEFINITIONS.length} platform tools and rewire tool_ids`
    )
    return
  }

  console.log('Syncing platform tools…')
  const { ids: toolIds, summary } = await syncTools(env.apiKey, flags)
  console.log(`  ${summary}`)

  const promptChanged = localPrompt !== livePrompt
  const idsChanged =
    liveToolIds.length !== toolIds.length ||
    liveToolIds.some((id, i) => id !== toolIds[i])

  const patch: Record<string, unknown> = {
    conversation_config: {
      agent: {
        prompt: {
          prompt: localPrompt,
          tool_ids: toolIds
        }
      },
      ...(env.voiceId ? { tts: { voice_id: env.voiceId } } : {})
    }
  }

  await api(env.apiKey, 'PATCH', `/v1/convai/agents/${env.agentId}`, patch)
  console.log(`\n✓ Updated agent ${env.agentId}.`)
  if (promptChanged) {
    console.log(`  prompt: ${livePrompt.length} → ${localPrompt.length} chars`)
  }
  if (idsChanged) {
    console.log(`  tool_ids: ${liveToolIds.length} → ${toolIds.length}`)
  }
  if (env.voiceId) console.log(`  voice_id: ${env.voiceId}`)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
