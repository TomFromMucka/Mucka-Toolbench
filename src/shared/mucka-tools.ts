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
  },

  /* ─── Auto-execute write tools ──────────────────────────────────── */
  {
    name: 'set_banner_status',
    description:
      "Set the PM status line in the top orange banner. Use this for a short, ambient note about the day's plan or what you're tracking. Pass an empty text to clear it. Auto-executes — no confirmation needed.",
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The status line. Empty string clears it.'
        }
      },
      required: ['text']
    }
  },
  {
    name: 'add_notice',
    description:
      "Pin a short note to the cockpit's notice board. Use for things Tom asked you to remember, reminders to himself, or context other agents should see. Colours are 'cream' (default), 'yellow', 'pink', 'blue'.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title — a few words.' },
        body: { type: 'string', description: 'The note body, one or two short sentences.' },
        colour: {
          type: 'string',
          description: 'Post-it colour.',
          enum: ['cream', 'yellow', 'pink', 'blue']
        }
      },
      required: ['title', 'body']
    }
  },
  {
    name: 'remove_notice',
    description:
      "Remove a notice from the board by its title (exact match, case-sensitive). Use when Tom says he's done with it.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Exact title of the notice to remove.' }
      },
      required: ['title']
    }
  },
  {
    name: 'flag_attention',
    description:
      "Mark an agent as needing Tom's attention — the clipboard glows brand orange. Provide a short reason that's shown beneath the agent's name. Use sparingly — orange is the 'Tom, look here' channel.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        reason: {
          type: 'string',
          description: 'One-line reason shown to Tom. Keep it under 60 chars.'
        }
      },
      required: ['agent', 'reason']
    }
  },
  {
    name: 'clear_attention',
    description:
      "Remove the orange attention glow from an agent. Use when Tom acknowledges or the issue is resolved.",
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

  /* ─── Confirm-gated write tools ─────────────────────────────────── */
  {
    name: 'set_agent_worktree',
    description:
      "Change an agent's working directory (and restart its shell). REQUIRES Tom's confirmation via the confirm strip — call only when Tom explicitly asks to switch an agent to a different worktree.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        path: { type: 'string', description: 'Absolute path to the worktree.' }
      },
      required: ['agent', 'path']
    }
  },
  {
    name: 'set_agent_command',
    description:
      "Change which command an agent runs in its terminal (e.g. switch from zsh to claude). REQUIRES confirmation — restarts the shell. Args is a space-separated string.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        command: {
          type: 'string',
          description: 'Executable path or name, e.g. /bin/zsh or claude.'
        },
        args: {
          type: 'string',
          description: 'Space-separated arguments. Empty string for none.'
        }
      },
      required: ['agent', 'command']
    }
  },
  {
    name: 'restart_agent',
    description:
      "Kill and respawn an agent's shell with its current config. REQUIRES confirmation — useful when a shell is stuck or Tom wants a fresh session without changing config.",
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
    name: 'send_to_agent',
    description:
      "Type a prompt or command into one agent's terminal and press Enter — the agent's Claude session (or whatever shell is running) receives it as input. ALWAYS confirms: Tom sees your proposed text in an editable strip and can tweak it before approving. Use when Tom says 'tell Dave to fix this' / 'I noticed X, get Sammy onto it' / 'have Kev try Y'. Make the text focused and actionable — short instructions work best.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        text: {
          type: 'string',
          description:
            "The exact text to type into the agent's terminal. Will be sent verbatim with Enter pressed at the end. Don't add quotes around it."
        }
      },
      required: ['agent', 'text']
    }
  }
] as const
