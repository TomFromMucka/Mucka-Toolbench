import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Ticket,
  TicketAction,
  TicketDetail,
  TicketFile,
  TicketFilter,
  TicketSendPreview,
  TicketSendResult
} from '@shared/types'
import {
  lastJsonLine,
  lastLine,
  loginShell,
  parseDetail,
  parseDownload,
  parseListing,
  parsePreview,
  parseResult,
  REFERENCE,
  UUID
} from './ticketCli'

const STATUSES = ['active', 'all', 'awaiting_reply', 'open', 'in_progress', 'resolved', 'closed']
const CATEGORIES = ['all', 'support', 'bug', 'migration', 'feature_request']
const SEND_STATUSES = ['in_progress', 'resolved', 'closed']
/** Shown inline: the types the app's own attachment route renders inline. */
const IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const INLINE_MAX_BYTES = 15 * 1024 * 1024
/** What macOS opens a file with comes from its extension, so ours come from the real type. */
const EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/** A customer's filename, made safe to sit in a path. */
function safeName(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '')
  return cleaned.slice(-80) || 'file'
}

export interface TicketDeskDeps {
  /** The read-only checkout of main that ticket.ts runs from. */
  checkout: () => Promise<string>
  env: () => NodeJS.ProcessEnv
  /** Where downloaded attachments live. Emptied at every start. */
  filesDir: string
  /** Re-read the polled list after something changed a ticket. */
  refresh: () => void
  openPath: (path: string) => Promise<string>
  showInFolder: (path: string) => void
}

/**
 * Tom's ticket desk: everything /admin/support does, through
 * `scripts/ticket.ts`. Customer files are kept apart from the app: images
 * come back as data URLs, PDFs open in Preview, and everything else is only
 * ever shown in Finder, because a customer's zip or Word file is theirs to
 * have sent and ours to look at, not to open by itself.
 */
export class TicketDesk {
  private readonly deps: TicketDeskDeps
  private dir: Promise<string> | null = null
  private readonly files = new Map<string, { path: string; filename: string; mimeType: string }>()

  constructor(deps: TicketDeskDeps) {
    this.deps = deps
    rmSync(deps.filesDir, { recursive: true, force: true })
  }

  /** The checkout is only moved by the watcher's poll; the desk just runs in it, unfetched. */
  private checkout(): Promise<string> {
    if (!this.dir) {
      this.dir = this.deps.checkout().catch((err: unknown) => {
        this.dir = null
        throw err
      })
    }
    return this.dir
  }

  private async run(cmd: string, vars: Record<string, string> = {}): Promise<unknown> {
    const dir = await this.checkout()
    try {
      const out = await loginShell(dir, `npx tsx scripts/ticket.ts ${cmd}`, {
        ...this.deps.env(),
        ...vars
      })
      return lastJsonLine(out)
    } catch (err) {
      throw new Error(lastLine(err))
    }
  }

  async browse(filter: TicketFilter): Promise<Ticket[]> {
    if (!STATUSES.includes(filter.status) || !CATEGORIES.includes(filter.category)) {
      throw new Error('Unknown ticket filter')
    }
    return parseListing(
      await this.run(
        'list --json --limit 500 --status "$T_STATUS" --category "$T_CATEGORY" --search "$T_SEARCH"',
        { T_STATUS: filter.status, T_CATEGORY: filter.category, T_SEARCH: filter.search.trim() }
      )
    )
  }

  async get(reference: string): Promise<TicketDetail> {
    const ref = checkRef(reference)
    return parseDetail(await this.run('show "$T_REF" --json', { T_REF: ref }))
  }

  /**
   * As opening it in /admin/support does. Separate from `get`, which also
   * runs when Tom only hovers. A failure only leaves the "awaiting reply"
   * badge up, so it's logged rather than shown.
   */
  async markRead(reference: string): Promise<void> {
    const ref = checkRef(reference)
    try {
      await this.run('mark-read "$T_REF"', { T_REF: ref })
      this.deps.refresh()
    } catch (err) {
      console.warn(`[tickets] mark-read ${ref}:`, err)
    }
  }

  private actionArgs(action: TicketAction): { cmd: string; vars: Record<string, string> } {
    const ref = checkRef(action.reference)
    const message = action.message?.trim() ?? ''
    if (action.status && !SEND_STATUSES.includes(action.status)) {
      throw new Error(`Unknown status ${action.status}`)
    }
    const vars: Record<string, string> = { T_REF: ref }
    if (message) {
      vars.T_MESSAGE = message
      if (action.status) vars.T_STATUS = action.status
      return {
        cmd: `reply "$T_REF" --message "$T_MESSAGE"${action.status ? ' --status "$T_STATUS"' : ''}`,
        vars
      }
    }
    if (!action.status) throw new Error('Nothing to send: no reply and no status change.')
    vars.T_STATUS = action.status
    return { cmd: 'status "$T_REF" "$T_STATUS"', vars }
  }

  async preview(action: TicketAction): Promise<TicketSendPreview> {
    const { cmd, vars } = this.actionArgs(action)
    return parsePreview(await this.run(`${cmd} --json`, vars))
  }

  async send(action: TicketAction): Promise<TicketSendResult> {
    const { cmd, vars } = this.actionArgs(action)
    try {
      return parseResult(await this.run(`${cmd} --send --json`, vars))
    } finally {
      this.deps.refresh()
    }
  }

  private async download(
    reference: string,
    attachmentId: string
  ): Promise<{ path: string; filename: string; mimeType: string }> {
    const ref = checkRef(reference)
    if (!UUID.test(attachmentId)) throw new Error('Not an attachment id')
    const key = `${ref}/${attachmentId}`
    const known = this.files.get(key)
    if (known && existsSync(known.path)) return known
    const dir = join(this.deps.filesDir, ref)
    mkdirSync(dir, { recursive: true })
    const out = join(dir, attachmentId)
    rmSync(out, { force: true })
    const saved = parseDownload(
      await this.run('attachment "$T_REF" "$T_ID" --out "$T_OUT"', {
        T_REF: ref,
        T_ID: attachmentId,
        T_OUT: out
      })
    )
    // A PDF or picture takes its extension from its checked type, so it
    // opens in Preview whatever the customer called it. Anything else keeps
    // a cleaned-up copy of its own name, for Finder.
    const ext = EXTENSIONS[saved.mimeType]
    const path = join(
      dir,
      ext ? `${attachmentId}.${ext}` : `${attachmentId}-${safeName(saved.filename)}`
    )
    rmSync(path, { force: true })
    renameSync(out, path)
    const file = { path, filename: saved.filename, mimeType: saved.mimeType }
    this.files.set(key, file)
    return file
  }

  async file(reference: string, attachmentId: string): Promise<TicketFile> {
    const { path, filename, mimeType } = await this.download(reference, attachmentId)
    const image = IMAGES.includes(mimeType)
    const bytes = image ? readFileSync(path) : null
    return {
      filename,
      mimeType,
      dataUrl:
        bytes && bytes.length <= INLINE_MAX_BYTES
          ? `data:${mimeType};base64,${bytes.toString('base64')}`
          : null,
      opens: mimeType === 'application/pdf' ? 'preview' : 'finder'
    }
  }

  async open(reference: string, attachmentId: string): Promise<void> {
    const { path, mimeType } = await this.download(reference, attachmentId)
    if (mimeType === 'application/pdf' || IMAGES.includes(mimeType)) {
      const problem = await this.deps.openPath(path)
      if (problem) throw new Error(problem)
      return
    }
    this.deps.showInFolder(path)
  }
}

function checkRef(reference: string): string {
  if (!REFERENCE.test(reference)) throw new Error(`Not a ticket reference: ${reference}`)
  return reference
}
