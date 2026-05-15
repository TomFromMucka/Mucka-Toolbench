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
  {
    name: 'get_recent_events',
    description:
      "Returns recent entries from the cockpit's job sheet — Vercel deploys, GitHub PR + CI transitions, attention flags, config changes. Prefer this for 'what's been going on?' since it's a chronological summary of state changes across every system. Pass `agent` to filter to one source; pass `limit` to widen the window (default 15).",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description:
            'Optional — one of dave, sammy, kev, or bren. Omit for all sources (including mucka and system events).',
          enum: MUCKA_AGENT_IDS
        },
        limit: {
          type: 'number',
          description: 'How many entries to return. Defaults to 15, capped at 50.'
        }
      },
      required: []
    }
  },
  {
    name: 'list_memories',
    description:
      "Returns a topic + preview index of your persistent memory store. Use this BEFORE answering anything that depends on what you've remembered about Tom or past decisions — your prompt has only the always-on basics. Each entry is one line: topic · type · 120-char preview. Then call get_memory for the full body of the one you need. Filter by `type` (profile / preference / project / decision / note) or `tag`. Default limit 50, capped 100.",
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: 'Optional — narrow to one memory type.',
          enum: ['profile', 'preference', 'project', 'decision', 'note']
        },
        tag: {
          type: 'string',
          description: 'Optional — only return memories tagged with this string.'
        },
        limit: {
          type: 'number',
          description: 'How many entries to return. Default 50, max 100.'
        }
      },
      required: []
    }
  },
  {
    name: 'get_memory',
    description:
      "Returns the full body of one memory by its topic slug. Call this after list_memories has shown you something relevant. If the topic doesn't exist, returns an explicit 'not found' note — don't fabricate.",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The exact topic slug as returned by list_memories.'
        }
      },
      required: ['topic']
    }
  },
  {
    name: 'remember',
    description:
      "Save a fact for future sessions. Use when Tom tells you something worth keeping (a preference, an ongoing initiative, a decision and why, a note about himself or a project). Topic is the upsert key — same topic OVERWRITES the existing body, so reuse the same topic to update an existing memory rather than duplicating. Body should be 1-3 sentences; for preferences/decisions include a brief 'Why' so future-you can judge edge cases. Pick a fitting type: profile / preference / project / decision / note. Auto-executes — no confirmation needed.",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description:
            "Short kebab-case slug (e.g. 'voice-style', 'mucka-pro-stack', 'worktree-layout'). Reuse to update."
        },
        type: {
          type: 'string',
          description: 'Which bucket this memory belongs to.',
          enum: ['profile', 'preference', 'project', 'decision', 'note']
        },
        body: {
          type: 'string',
          description:
            "The fact itself. 1-3 sentences. For preferences/decisions, lead with the rule then a brief 'Why:' line."
        },
        tags: {
          type: 'string',
          description:
            'Optional comma-separated tags for filtering later (e.g. "ui,brand" or "deploy,vercel").'
        }
      },
      required: ['topic', 'type', 'body']
    }
  },
  {
    name: 'forget',
    description:
      "Remove a memory by topic. REQUIRES Tom's confirmation — losing context is destructive. Only call when Tom explicitly says 'forget that' or the memory is plainly wrong and an update via `remember` doesn't fit.",
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'The exact topic slug to delete.'
        }
      },
      required: ['topic']
    }
  },
  {
    name: 'get_cockpit_doc',
    description:
      "Reads the cockpit's living spec at MUCKA.md (mission, current capabilities, systems, recent changes, roadmap). Call this BEFORE answering questions about what the toolbench can do, what's coming next, what shipped recently, or when Tom asks for priority suggestions — the doc is the source of truth and isn't in your prompt by default. Pass `section` to fetch just one block (e.g. \"Roadmap\", \"Capabilities\", \"Recent changes\"); omit for the whole file.",
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description:
            'Optional heading name (matches a `## Heading` in the doc, case-insensitive). Common values: "Mission", "Capabilities", "Systems", "Recent changes", "Roadmap". Omit for the whole document.'
        }
      },
      required: []
    }
  },
  {
    name: 'get_pr_status',
    description:
      "Returns GitHub PR + CI state for the agent's branch. With no `agent` arg, summarises across all four. With `agent` set, refreshes that one. Reports PR number, title, draft/open, mergeable state, rolled-up check status, and a link to the PR. Use when Tom asks 'is Sammy's PR green?', 'who's still got an open PR?', etc.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Optional — one of dave, sammy, kev, or bren. Omit for all.',
          enum: MUCKA_AGENT_IDS
        }
      },
      required: []
    }
  },
  {
    name: 'get_vercel_status',
    description:
      "Returns Vercel deployment state. With no `agent` arg, returns a one-line summary per agent (latest deployment state, branch, commit message, URL). With `agent` set, refreshes and reports that one agent in detail. Use when Tom asks 'is Sammy's PR deployed?' or 'how's the prod build?'. Reads the project id from agent config or auto-detects from the worktree's .vercel/project.json.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Optional — one of dave, sammy, kev, or bren. Omit for all.',
          enum: MUCKA_AGENT_IDS
        }
      },
      required: []
    }
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
    name: 'append_note',
    description:
      "Add a line or paragraph to Tom's free-form notes panel (a single scratchpad that replaces the old notice board). Use for things Tom asked you to write down, reminders, or context worth keeping. The text lands at the bottom with a blank line separator. Auto-executes — no confirmation needed.",
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description:
            'The note to append. Plain text. Keep it short — one sentence or a short bullet.'
        }
      },
      required: ['text']
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
    name: 'set_agent_preview',
    description:
      "Point one of the two right-column preview iframes at a dev-server URL for the given agent (e.g. http://localhost:3001). The first two agents with a preview URL fill the left and right preview slots in display order — so setting one for a third agent only shows up if you also clear one of the other two. Pass an empty url to clear that agent's preview. Auto-executes — no confirmation needed.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        url: {
          type: 'string',
          description:
            "Full http:// or https:// URL of the agent's dev server. Empty string to clear."
        }
      },
      required: ['agent', 'url']
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
    name: 'start_agent',
    description:
      "Spin up an idle agent — spawn its primary shell at its configured worktree. Idle agents show a 'Start' screen with no PTY running. Call this when Tom says 'wake up Sammy' / 'get Kev going' / 'start that one'. Auto-executes; non-destructive (it's just spawning a shell).",
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
    name: 'stop_agent',
    description:
      "Park an agent — kill its primary shell and every sub-terminal. REQUIRES Tom's confirmation since any unsaved state in the running session is lost. The agent's config is preserved; a future `start_agent` brings it back. Use when Tom says 'put Bren to sleep' / 'shut Dave down' / 'park that one'.",
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
    name: 'open_pr',
    description:
      "Open a pull request from this agent's branch via the gh CLI. REQUIRES confirmation. Types `gh pr create --fill` (or `--fill --draft`) into the agent's terminal, so Tom sees gh's output land naturally. The agent's worktree needs the gh CLI installed and authed. Use when Tom says 'open a PR for that' / 'let's get this reviewed'.",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent\'s branch — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        draft: {
          type: 'boolean',
          description: 'When true, open as draft. Defaults to false.'
        }
      },
      required: ['agent']
    }
  },
  {
    name: 'deploy_to_vercel',
    description:
      "Deploy this agent's worktree to Vercel. REQUIRES confirmation. Types `vercel` (preview) or `vercel --prod` (production) into the agent's terminal, so Tom sees the deploy logs land naturally. Use when Tom says 'deploy that to preview' / 'ship it to prod'. The Vercel CLI must already be authed in that worktree (vercel link has been run).",
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Which agent\'s worktree to deploy — dave, sammy, kev, or bren.',
          enum: MUCKA_AGENT_IDS
        },
        target: {
          type: 'string',
          description: 'Preview (default) or production deploy.',
          enum: ['preview', 'production']
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
