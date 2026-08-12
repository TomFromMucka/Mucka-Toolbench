import type { SentryIssue, SentryStatus } from '@shared/types'

/**
 * Sentry REST client.
 *
 * Base URL is the org's **region** host, not `sentry.io` — an org on the EU
 * region answers on `https://de.sentry.io/api/0/...` and 404s everything on
 * the US host, which looks exactly like a bad token. `SENTRY_REGION_URL`
 * carries it; `find_organizations` in the Sentry API reports it per org.
 */
const DEFAULT_REGION_URL = 'https://sentry.io'

function regionUrl(): string {
  const raw = process.env.SENTRY_REGION_URL?.trim()
  if (!raw) return DEFAULT_REGION_URL
  return raw.replace(/\/+$/, '')
}

function orgSlug(): string {
  return process.env.SENTRY_ORG_SLUG?.trim() ?? ''
}

function token(): string {
  return process.env.SENTRY_AUTH_TOKEN?.trim() ?? ''
}

export function getStatus(): SentryStatus {
  if (!token()) {
    return { kind: 'missing-token' }
  }
  if (!orgSlug()) {
    return { kind: 'missing-org' }
  }
  return { kind: 'ok' }
}

interface IssueRaw {
  id?: string
  shortId?: string
  title?: string
  culprit?: string | null
  level?: string
  status?: string
  substatus?: string | null
  count?: string | number
  userCount?: number
  firstSeen?: string
  lastSeen?: string
  permalink?: string
  priority?: string | null
  issueCategory?: string | null
  isUnhandled?: boolean
  project?: { slug?: string; name?: string }
  metadata?: { value?: string; type?: string; filename?: string }
}

function toNumber(v: string | number | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function toMs(iso: string | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

function normalise(raw: IssueRaw): SentryIssue {
  return {
    id: raw.id ?? '',
    shortId: raw.shortId ?? raw.id ?? '',
    title: raw.title ?? '(untitled)',
    culprit: raw.culprit ?? null,
    level: raw.level ?? 'error',
    status: raw.status ?? 'unresolved',
    substatus: raw.substatus ?? null,
    count: toNumber(raw.count),
    userCount: raw.userCount ?? 0,
    firstSeen: toMs(raw.firstSeen),
    lastSeen: toMs(raw.lastSeen),
    permalink: raw.permalink ?? '',
    priority: raw.priority ?? null,
    category: raw.issueCategory ?? null,
    isUnhandled: raw.isUnhandled ?? false,
    project: raw.project?.slug ?? '',
    // `metadata.value` is the exception message where the title is just the
    // type — worth carrying, it's often the only useful line.
    detail: raw.metadata?.value ?? null
  }
}

async function call(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {}
): Promise<Response> {
  const status = getStatus()
  if (status.kind !== 'ok') {
    throw new Error(
      status.kind === 'missing-token'
        ? 'Sentry auth token not set'
        : 'Sentry org slug not set'
    )
  }
  const res = await fetch(`${regionUrl()}/api/0${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const hint =
      res.status === 404
        ? ' — check SENTRY_REGION_URL matches the org region (e.g. https://de.sentry.io)'
        : ''
    throw new Error(
      `Sentry ${res.status} ${res.statusText}${hint}${body ? `: ${body.slice(0, 200)}` : ''}`
    )
  }
  return res
}

export interface ListIssuesOptions {
  /** Sentry issue search syntax. Defaults to unresolved. */
  query?: string
  /** e.g. "24h", "7d". */
  statsPeriod?: string
  limit?: number
  signal?: AbortSignal
}

/**
 * Issues across every project in the org. `project=-1` is Sentry's
 * "all projects I can see" wildcard — the cockpit deliberately doesn't
 * filter, so a new project starts reporting the moment it's created.
 */
export async function listIssues(opts: ListIssuesOptions = {}): Promise<SentryIssue[]> {
  const params = new URLSearchParams({
    query: opts.query ?? 'is:unresolved',
    statsPeriod: opts.statsPeriod ?? '14d',
    limit: String(opts.limit ?? 50),
    project: '-1',
    sort: 'new'
  })
  const res = await call(`/organizations/${orgSlug()}/issues/?${params}`, {
    signal: opts.signal
  })
  const data = (await res.json()) as IssueRaw[]
  if (!Array.isArray(data)) return []
  return data.map(normalise).filter((i) => i.id.length > 0)
}

/**
 * The issue endpoint takes the numeric id, but everything human-facing —
 * the triage prompt, the job sheet, what Tom reads in Sentry — is the
 * short id ("MUCKA-WEB-38"). Resolve one to the other so callers can pass
 * whichever they have.
 */
async function toNumericId(issueId: string): Promise<string> {
  const raw = issueId.trim()
  if (/^\d+$/.test(raw)) return raw
  const res = await call(`/organizations/${orgSlug()}/shortids/${encodeURIComponent(raw)}/`)
  const data = (await res.json()) as { groupId?: string; group?: { id?: string } }
  const id = data.groupId ?? data.group?.id
  if (!id) throw new Error(`Could not resolve Sentry short id ${raw}`)
  return id
}

export async function getIssue(issueId: string): Promise<SentryIssue> {
  const id = await toNumericId(issueId)
  const res = await call(`/organizations/${orgSlug()}/issues/${id}/`)
  return normalise((await res.json()) as IssueRaw)
}

/**
 * Archive an issue — the API still calls this `ignored`; `archived_forever`
 * is what the UI shows as "Archived". Anything Mucka triages as noise ends
 * up here, and un-archiving is one click in Sentry if she got it wrong.
 */
export async function archiveIssue(issueId: string): Promise<void> {
  const id = await toNumericId(issueId)
  await call(`/organizations/${orgSlug()}/issues/${id}/`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'ignored', substatus: 'archived_forever' })
  })
}
