/**
 * Single source of truth for Mucka's client-tool schemas.
 *
 * - Renderer imports this to know which tools to register handlers for.
 * - The mucka:sync script imports this to push the schemas into the
 *   ElevenLabs agent so the LLM knows the tools exist and how to call them.
 *
 * Tool names are case-sensitive — the dashboard schema and the renderer
 * handler MUST match exactly.
 */

import type { AgentId } from './types'

export const MUCKA_AGENT_IDS: readonly AgentId[] = [
  'dave',
  'sammy',
  'kev',
  'bren'
] as const

/** JSON-Schema-ish shape ElevenLabs accepts for client-tool parameters. */
export interface ToolParamSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'boolean'
      description?: string
      enum?: readonly string[]
    }
  >
  required: readonly string[]
}

export interface MuckaToolDefinition {
  name: string
  description: string
  parameters: ToolParamSchema
}

export const TOOL_DEFINITIONS: readonly MuckaToolDefinition[] = [
  {
    name: 'list_agents',
    description:
      "Returns a summary of the four agents currently configured in Tom's cockpit — their names, the branch label each is working on, the worktree path, and the command running inside (zsh or claude). Call this when Tom asks who's around or wants to know the lineup.",
    parameters: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_git_status',
    description:
      "Returns the live git status for one agent's worktree: current branch, ahead/behind upstream, modified/staged/untracked file counts. Call this when Tom asks about an agent's branch state or commit progress.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        }
      },
      required: ['agent']
    }
  },
  {
    name: 'get_recent_output',
    description:
      "Returns the most recent terminal output for one agent (default last 20 lines). Strips terminal escape codes. Call this when Tom asks what an agent has been doing, or to read context before saying anything specific about an agent's progress.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        lines: {
          type: 'number',
          description: 'How many trailing lines to return. Defaults to 20.'
        }
      },
      required: ['agent']
    }
  },
  {
    name: 'whats_happening',
    description:
      "Returns a one-shot summary across all four agents: each one's branch, git status, and last few terminal lines. Use this when Tom opens a session with a vague 'what's up?' so you don't have to chain three other tools.",
    parameters: { type: 'object', properties: {}, required: [] }
  }
] as const
