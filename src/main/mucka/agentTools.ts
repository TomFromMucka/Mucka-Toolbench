import { z, type ZodTypeAny } from 'zod'
import {
  createSdkMcpServer,
  tool,
  type SdkMcpToolDefinition
} from '@anthropic-ai/claude-agent-sdk'
import { TOOL_DEFINITIONS, type MuckaToolDefinition } from '@shared/mucka-tools'

/**
 * Builds an in-process MCP server that exposes every cockpit tool to the
 * Claude Agent SDK. Each tool's handler proxies through the host's
 * `dispatchTool` so renderer-side execution + confirm strips behave the
 * same as the legacy Anthropic-SDK backend.
 */

export interface ToolDispatcher {
  dispatch: (
    name: string,
    params: Record<string, unknown>
  ) => Promise<{ ok: boolean; result: string }>
}

function buildZodShape(def: MuckaToolDefinition): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {}
  for (const [key, prop] of Object.entries(def.parameters.properties)) {
    let field: ZodTypeAny
    if (prop.type === 'string') {
      if (prop.enum && prop.enum.length > 0) {
        const values = [...prop.enum] as [string, ...string[]]
        field = z.enum(values)
      } else {
        field = z.string()
      }
    } else if (prop.type === 'number') {
      field = z.number()
    } else if (prop.type === 'boolean') {
      field = z.boolean()
    } else {
      field = z.unknown() as unknown as ZodTypeAny
    }
    if (prop.description) field = field.describe(prop.description)
    if (!def.parameters.required.includes(key)) field = field.optional()
    shape[key] = field
  }
  return shape
}

export function buildMuckaMcpServer(
  dispatcher: ToolDispatcher
): ReturnType<typeof createSdkMcpServer> {
  const tools: SdkMcpToolDefinition[] = TOOL_DEFINITIONS.map((def) => {
    const shape = buildZodShape(def)
    return tool(
      def.name,
      def.description,
      shape,
      async (args: unknown) => {
        const params = (args ?? {}) as Record<string, unknown>
        try {
          const out = await dispatcher.dispatch(def.name, params)
          return {
            content: [{ type: 'text', text: out.result || '(empty)' }],
            isError: !out.ok
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          return {
            content: [{ type: 'text', text: message }],
            isError: true
          }
        }
      }
    ) as SdkMcpToolDefinition
  })

  return createSdkMcpServer({ name: 'mucka-cockpit', tools })
}
