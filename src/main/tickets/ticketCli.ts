import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  TicketAttachment,
  TicketConversation,
  TicketDetail,
  TicketMessage,
  TicketSendPreview,
  TicketSendResult
} from '@shared/types'
import type { TicketListing } from '../db/tickets'

/**
 * Shared plumbing for driving Mucka Pro's `scripts/ticket.ts` from the
 * cockpit. Every ticket read and write goes through that script, so the
 * database URL and the HQ password stay in ~/.mucka and never reach here.
 */

const execFileAsync = promisify(execFile)

export const REFERENCE = /^TKT-\d+$/
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Run `cmd` in a login shell, so node, npx and claude are on the PATH.
 * Anything that came from Tom or a customer goes in through `env` and is
 * quoted as "$VAR" in `cmd`, never spliced into the string.
 */
export async function loginShell(
  cwd: string,
  cmd: string,
  env: NodeJS.ProcessEnv,
  timeout = 120_000
): Promise<string> {
  const { stdout } = await execFileAsync('/bin/zsh', ['-l', '-c', cmd], {
    cwd,
    env,
    timeout,
    maxBuffer: 64 * 1024 * 1024
  })
  return stdout
}

/** The last thing the command said on stderr: ticket.ts's own error line. */
export function lastLine(err: unknown): string {
  const stderr =
    typeof err === 'object' && err !== null && 'stderr' in err && typeof err.stderr === 'string'
      ? err.stderr
      : ''
  const line = stderr
    .trim()
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .pop()
  return line ?? (err instanceof Error ? err.message.split('\n')[0] : String(err))
}

/** npx can print notices first; the JSON is always the last line. */
export function lastJsonLine(stdout: string): unknown {
  return JSON.parse(stdout.trim().split('\n').pop() ?? 'null')
}

type Rec = Record<string, unknown>

function rec(v: unknown): Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v))
    : {}
}

function list(v: unknown): Rec[] {
  return Array.isArray(v) ? v.map(rec) : []
}

function str(row: Rec, key: string): string | null {
  const v = row[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(row: Rec, key: string): number | null {
  const v = row[key]
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function time(row: Rec, key: string): number | null {
  const v = str(row, key)
  const n = v ? Date.parse(v) : NaN
  return Number.isFinite(n) ? n : null
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function parseListing(parsed: unknown): TicketListing[] {
  if (!Array.isArray(parsed)) throw new Error('ticket list was not a JSON array')
  const out: TicketListing[] = []
  for (const row of list(parsed)) {
    const reference = str(row, 'reference')
    if (!reference || !REFERENCE.test(reference)) continue
    out.push({
      reference,
      subject: str(row, 'subject') ?? '(no subject)',
      status: str(row, 'status') ?? 'open',
      priority: str(row, 'priority'),
      category: str(row, 'category'),
      business: str(row, 'business_name'),
      raiser: str(row, 'raiser_name'),
      createdAt: time(row, 'created_at') ?? 0,
      updatedAt: time(row, 'updated_at') ?? 0,
      awaitingReply: row.awaiting_reply === true,
      lastAuthor: str(row, 'last_author_type'),
      customerVisible: row.customer_visible !== false
    })
  }
  return out
}

function person(p: Rec): string {
  const name = str(p, 'name') ?? 'Unnamed'
  const email = str(p, 'email')
  return email ? `${name} <${email}>` : name
}

export function parseDetail(parsed: unknown): TicketDetail {
  const root = rec(parsed)
  const t = rec(root.ticket)
  const reference = str(t, 'reference')
  if (!reference) throw new Error('ticket.ts show --json returned no ticket')

  const messages: TicketMessage[] = list(root.messages).map((m) => ({
    id: str(m, 'id') ?? '',
    authorType: str(m, 'author_type') ?? 'user',
    authorName: str(m, 'author_name'),
    content: str(m, 'content') ?? '',
    createdAt: time(m, 'created_at') ?? 0,
    heldUntil: str(m, 'notified_at') ? null : time(m, 'notify_after')
  }))

  const attachments: TicketAttachment[] = list(root.attachments).flatMap((a) => {
    const id = str(a, 'id')
    if (!id || !UUID.test(id)) return []
    return [
      {
        id,
        messageId: str(a, 'message_id'),
        filename: str(a, 'filename') ?? 'file',
        mimeType: str(a, 'mime_type') ?? 'application/octet-stream',
        sizeBytes: num(a, 'size_bytes'),
        uploader: str(a, 'uploader_type'),
        createdAt: time(a, 'created_at') ?? 0
      }
    ]
  })

  let conversation: TicketConversation | null = null
  if (root.conversation) {
    const c = rec(root.conversation)
    conversation = {
      channel: str(c, 'channel'),
      source: str(c, 'source'),
      summary: str(c, 'summary'),
      startedAt: time(c, 'started_at'),
      messageCount: num(c, 'message_count'),
      truncated: c.truncated === true,
      messages: list(c.messages).map((m) => ({
        role: str(m, 'role') ?? 'unknown',
        content: str(m, 'content') ?? '',
        tools: strings(m.tool_calls),
        createdAt: time(m, 'created_at') ?? 0
      }))
    }
  }

  const raiserName = str(t, 'raiser_name')
  return {
    reference,
    status: str(t, 'status') ?? 'open',
    priority: str(t, 'priority'),
    category: str(t, 'category'),
    subject: str(t, 'subject') ?? '(no subject)',
    body: str(t, 'body') ?? '',
    adminNotes: str(t, 'admin_notes'),
    customerVisible: t.customer_visible !== false,
    createdAt: time(t, 'created_at') ?? 0,
    updatedAt: time(t, 'updated_at') ?? 0,
    resolvedAt: time(t, 'resolved_at'),
    business: str(t, 'business_name'),
    raiser: raiserName
      ? { name: raiserName, role: str(t, 'raiser_role'), email: str(t, 'raiser_email') }
      : null,
    participants: list(root.participants).map(person),
    messages,
    attachments,
    conversation
  }
}

export function parsePreview(parsed: unknown): TicketSendPreview {
  const p = rec(parsed)
  return {
    people: strings(p.people),
    from: str(p, 'from') ?? '',
    to: str(p, 'to'),
    nobody: str(p, 'nobody'),
    channels: strings(p.channels),
    heldUntilLabel: str(p, 'heldUntilLabel')
  }
}

export function parseResult(parsed: unknown): TicketSendResult {
  const r = rec(parsed)
  return {
    replied: r.replied === true,
    status: str(r, 'status'),
    heldUntilLabel: str(r, 'heldUntilLabel'),
    attachmentError: str(r, 'attachmentError')
  }
}

export function parseDownload(parsed: unknown): {
  path: string
  filename: string
  mimeType: string
} {
  const d = rec(parsed)
  const path = str(d, 'path')
  if (!path) throw new Error('ticket.ts attachment did not say where it saved the file')
  return {
    path,
    filename: str(d, 'filename') ?? 'file',
    mimeType: str(d, 'mime_type') ?? 'application/octet-stream'
  }
}
