import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  AgentConfig,
  AgentUpdate,
  Memory,
  MemoryListItem,
  MemoryType
} from '@shared/types'
import { Clipboard } from './Clipboard'

interface SettingsModalProps {
  open: boolean
  agents: AgentConfig[]
  onClose: () => void
  onSave: (patch: AgentUpdate) => Promise<void>
}

type Tab = 'agents' | 'memory'

const FIELD =
  'w-full rounded-sm border border-ink/20 bg-paper-cream px-2 py-1 font-mono text-[0.82rem] text-ink focus:border-mucka focus:outline-none focus:ring-1 focus:ring-mucka'

const LABEL =
  'block text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint font-sans'

const MEMORY_TYPES: readonly MemoryType[] = [
  'profile',
  'preference',
  'project',
  'decision',
  'note'
] as const

export function SettingsModal({
  open,
  agents,
  onClose,
  onSave
}: SettingsModalProps): React.JSX.Element | null {
  const [tab, setTab] = useState<Tab>('agents')

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/55 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="mt-10 w-[860px] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <Clipboard
          title="Settings"
          subtitle={tab === 'agents' ? 'agent worktrees & commands' : "Mucka's long-term memory"}
          paper="lined"
          rightSlot={
            <button
              type="button"
              onClick={onClose}
              className="rounded-sm border border-paper-cream/30 px-2 py-0.5 text-[0.7rem] uppercase tracking-wide hover:bg-paper-cream/15"
            >
              close
            </button>
          }
        >
          <TabStrip tab={tab} onChange={setTab} />
          <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
            {tab === 'agents' ? (
              <AgentsTab agents={agents} onSave={onSave} onClose={onClose} />
            ) : (
              <MemoryTab />
            )}
          </div>
        </Clipboard>
      </div>
    </div>
  )
}

interface TabStripProps {
  tab: Tab
  onChange: (next: Tab) => void
}

function TabStrip({ tab, onChange }: TabStripProps): React.JSX.Element {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'agents', label: 'Agents' },
    { id: 'memory', label: 'Memory' }
  ]
  return (
    <div className="flex gap-1 border-b border-ink/15 bg-paper-shadow/50 px-3 pt-2">
      {tabs.map((t) => {
        const active = t.id === tab
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={clsx(
              'rounded-t-sm border-b-2 px-3 py-1.5 font-sans text-[0.78rem] uppercase tracking-wide',
              active
                ? 'border-mucka bg-paper-cream text-ink'
                : 'border-transparent text-ink-soft hover:text-ink'
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/* ─── Agents tab ─────────────────────────────────────────────────────── */

interface DraftRow {
  agentId: AgentConfig['id']
  displayName: string
  branch: string
  worktreePath: string
  command: string
  argsRaw: string
  previewUrl: string
  vercelProjectId: string
  dirty: boolean
}

function toDraft(agent: AgentConfig): DraftRow {
  return {
    agentId: agent.id,
    displayName: agent.displayName,
    branch: agent.branch,
    worktreePath: agent.worktreePath,
    command: agent.command,
    argsRaw: agent.args.join(' '),
    previewUrl: agent.previewUrl ?? '',
    vercelProjectId: agent.vercelProjectId ?? '',
    dirty: false
  }
}

function parseArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface AgentsTabProps {
  agents: AgentConfig[]
  onSave: (patch: AgentUpdate) => Promise<void>
  onClose: () => void
}

function AgentsTab({ agents, onSave, onClose }: AgentsTabProps): React.JSX.Element {
  const [drafts, setDrafts] = useState<DraftRow[]>(() => agents.map(toDraft))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDrafts(agents.map(toDraft))
  }, [agents])

  const dirtyCount = drafts.filter((d) => d.dirty).length

  function patchDraft(id: string, patch: Partial<DraftRow>): void {
    setDrafts((prev) =>
      prev.map((d) => (d.agentId === id ? { ...d, ...patch, dirty: true } : d))
    )
  }

  async function pickPath(d: DraftRow): Promise<void> {
    const picked = await window.mucka.pickDirectory({
      defaultPath: d.worktreePath
    })
    if (picked) patchDraft(d.agentId, { worktreePath: picked })
  }

  function setCommandPreset(d: DraftRow, preset: 'zsh' | 'claude'): void {
    if (preset === 'zsh') {
      patchDraft(d.agentId, { command: '/bin/zsh', argsRaw: '-l' })
    } else {
      patchDraft(d.agentId, { command: 'claude', argsRaw: '' })
    }
  }

  async function handleSave(): Promise<void> {
    setSaving(true)
    try {
      for (const d of drafts) {
        if (!d.dirty) continue
        const trimmedPreview = d.previewUrl.trim()
        const trimmedVercel = d.vercelProjectId.trim()
        await onSave({
          id: d.agentId,
          displayName: d.displayName,
          branch: d.branch,
          worktreePath: d.worktreePath,
          command: d.command,
          args: parseArgs(d.argsRaw),
          previewUrl: trimmedPreview === '' ? null : trimmedPreview,
          vercelProjectId: trimmedVercel === '' ? null : trimmedVercel
        })
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <p className="mb-3 font-[var(--font-hand)] text-[0.92rem] text-ink-soft">
        Point each clipboard at a real git worktree, and choose what to
        run inside it. Saving restarts that agent&apos;s shell.
      </p>

      <ul className="space-y-4">
        {drafts.map((d) => (
          <li
            key={d.agentId}
            className={clsx(
              'rounded-sm border border-ink/20 bg-paper-cream/85 p-3 shadow-[0_1px_2px_rgba(0,0,0,0.12)]',
              d.dirty && 'ring-1 ring-mucka/60'
            )}
          >
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-[var(--font-display)] text-[1.15rem] font-semibold text-ink">
                {d.displayName}{' '}
                <span className="text-[0.7rem] uppercase tracking-wide text-ink-faint">
                  · {d.agentId}
                </span>
              </h3>
              {d.dirty ? (
                <span className="text-[0.7rem] uppercase tracking-wide text-mucka-deep">
                  unsaved
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Display name</label>
                <input
                  className={FIELD}
                  value={d.displayName}
                  onChange={(e) =>
                    patchDraft(d.agentId, { displayName: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={LABEL}>Branch label</label>
                <input
                  className={FIELD}
                  value={d.branch}
                  onChange={(e) =>
                    patchDraft(d.agentId, { branch: e.target.value })
                  }
                  placeholder="e.g. feat/onboarding"
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>Worktree path (cwd)</label>
                <div className="flex gap-2">
                  <input
                    className={FIELD}
                    value={d.worktreePath}
                    onChange={(e) =>
                      patchDraft(d.agentId, {
                        worktreePath: e.target.value
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => pickPath(d)}
                    className="shrink-0 rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow"
                  >
                    Browse…
                  </button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Command</label>
                <div className="flex gap-1">
                  <input
                    className={FIELD}
                    value={d.command}
                    onChange={(e) =>
                      patchDraft(d.agentId, { command: e.target.value })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setCommandPreset(d, 'zsh')}
                    className="shrink-0 rounded-sm border border-ink/30 px-1.5 py-1 text-[0.7rem] uppercase tracking-wide hover:bg-paper-shadow"
                    title="Preset: /bin/zsh -l"
                  >
                    zsh
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommandPreset(d, 'claude')}
                    className="shrink-0 rounded-sm border border-mucka/60 bg-mucka/10 px-1.5 py-1 text-[0.7rem] uppercase tracking-wide text-mucka-deep hover:bg-mucka/20"
                    title="Preset: claude"
                  >
                    claude
                  </button>
                </div>
              </div>
              <div>
                <label className={LABEL}>Args (space-separated)</label>
                <input
                  className={FIELD}
                  value={d.argsRaw}
                  onChange={(e) =>
                    patchDraft(d.agentId, { argsRaw: e.target.value })
                  }
                  placeholder='e.g. -l or --no-tui'
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>
                  Preview URL{' '}
                  <span className="normal-case tracking-normal text-ink-faint">
                    (dev server iframed in right column — leave blank to hide)
                  </span>
                </label>
                <input
                  className={FIELD}
                  value={d.previewUrl}
                  onChange={(e) =>
                    patchDraft(d.agentId, { previewUrl: e.target.value })
                  }
                  placeholder="e.g. http://localhost:3001"
                />
              </div>
              <div className="col-span-2">
                <label className={LABEL}>
                  Vercel project ID{' '}
                  <span className="normal-case tracking-normal text-ink-faint">
                    (overrides .vercel/project.json — leave blank to auto-detect)
                  </span>
                </label>
                <input
                  className={FIELD}
                  value={d.vercelProjectId}
                  onChange={(e) =>
                    patchDraft(d.agentId, { vercelProjectId: e.target.value })
                  }
                  placeholder="prj_..."
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-end gap-2 border-t border-ink/15 pt-3">
        <span className="mr-auto text-[0.78rem] text-ink-soft font-sans">
          {dirtyCount === 0
            ? 'No changes'
            : `${dirtyCount} agent${dirtyCount === 1 ? '' : 's'} changed — saving will restart their shells`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-sm border border-ink/30 px-3 py-1 font-sans text-[0.8rem] text-ink hover:bg-paper-shadow"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
          className="rounded-sm bg-mucka px-3 py-1 font-sans text-[0.8rem] font-semibold uppercase tracking-wide text-paper-cream shadow-[0_1px_2px_rgba(0,0,0,0.25)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save & restart'}
        </button>
      </div>
    </>
  )
}

/* ─── Memory tab ─────────────────────────────────────────────────────── */

function relativeAgo(ms: number): string {
  if (!ms) return 'never'
  const diff = Date.now() - ms
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

const TYPE_BADGE: Record<MemoryType, string> = {
  profile: 'bg-mucka/15 text-mucka-deep',
  preference: 'bg-status-ok/15 text-ink',
  project: 'bg-status-warn/15 text-ink',
  decision: 'bg-ink/15 text-ink',
  note: 'bg-paper-shadow text-ink-soft'
}

function MemoryTab(): React.JSX.Element {
  const [items, setItems] = useState<MemoryListItem[] | null>(null)
  const [filter, setFilter] = useState<'all' | MemoryType>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [bodyCache, setBodyCache] = useState<Record<string, Memory>>({})
  const [draft, setDraft] = useState<{ topic: string; body: string; tags: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const reload = useCallback(async () => {
    const next = await window.mucka.listMemories({ limit: 100 })
    setItems(next)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const filtered = useMemo(() => {
    if (!items) return []
    if (filter === 'all') return items
    return items.filter((m) => m.type === filter)
  }, [items, filter])

  async function handleExpand(topic: string): Promise<void> {
    if (expanded === topic) {
      setExpanded(null)
      setDraft(null)
      return
    }
    setExpanded(topic)
    setDraft(null)
    if (!bodyCache[topic]) {
      const full = await window.mucka.getMemory(topic)
      if (full) setBodyCache((prev) => ({ ...prev, [topic]: full }))
    }
  }

  function beginEdit(memory: Memory): void {
    setDraft({
      topic: memory.topic,
      body: memory.body,
      tags: memory.tags.join(', ')
    })
  }

  async function saveDraft(memory: Memory): Promise<void> {
    if (!draft) return
    const body = draft.body.trim()
    if (!body) return
    setSaving(true)
    try {
      const tags = draft.tags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
      const saved = await window.mucka.rememberMemory({
        topic: memory.topic,
        type: memory.type,
        body,
        tags
      })
      setBodyCache((prev) => ({ ...prev, [saved.topic]: saved }))
      setDraft(null)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  async function deleteMemory(topic: string): Promise<void> {
    if (!confirm(`Forget "${topic}"? This can't be undone.`)) return
    setSaving(true)
    try {
      await window.mucka.forgetMemory(topic)
      setBodyCache((prev) => {
        const { [topic]: _, ...rest } = prev
        return rest
      })
      if (expanded === topic) setExpanded(null)
      setDraft(null)
      await reload()
    } finally {
      setSaving(false)
    }
  }

  if (items === null) {
    return (
      <p className="font-[var(--font-hand)] text-[0.92rem] text-ink-faint">
        Loading memories…
      </p>
    )
  }

  return (
    <>
      <p className="mb-3 font-[var(--font-hand)] text-[0.92rem] text-ink-soft">
        Everything Mucka has stored about you and ongoing work. She writes
        these as you talk — edit a body to refine, or delete to start fresh.
        Topics are stable keys, so the same topic gets updated rather than
        duplicated.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          label={`all (${items.length})`}
        />
        {MEMORY_TYPES.map((t) => {
          const count = items.filter((m) => m.type === t).length
          return (
            <FilterChip
              key={t}
              active={filter === t}
              onClick={() => setFilter(t)}
              label={`${t} (${count})`}
              disabled={count === 0}
            />
          )
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-sm border border-ink/15 bg-paper-cream/60 px-3 py-2 font-[var(--font-hand)] text-[0.92rem] text-ink-faint">
          {items.length === 0
            ? "No memories yet. Mucka will start saving things as you talk to her — preferences, decisions, project context."
            : `No memories in this filter.`}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((m) => {
            const isOpen = expanded === m.topic
            const full = bodyCache[m.topic]
            const isEditing = isOpen && draft && draft.topic === m.topic
            return (
              <li
                key={m.topic}
                className="rounded-sm border border-ink/20 bg-paper-cream/85 shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
              >
                <button
                  type="button"
                  onClick={() => void handleExpand(m.topic)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-paper-shadow/40"
                >
                  <span
                    className={clsx(
                      'mt-0.5 rounded-sm px-1.5 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide',
                      TYPE_BADGE[m.type]
                    )}
                  >
                    {m.type}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[0.85rem] text-ink">
                      {m.topic}
                    </span>
                    <span className="block truncate font-[var(--font-hand)] text-[0.88rem] text-ink-soft">
                      {m.preview}
                    </span>
                  </span>
                  <span className="shrink-0 self-center font-sans text-[0.7rem] text-ink-faint">
                    {relativeAgo(m.updatedAt)}
                  </span>
                </button>

                {isOpen && full ? (
                  <div className="border-t border-ink/15 px-3 py-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <div>
                          <label className={LABEL}>Body</label>
                          <textarea
                            className={clsx(FIELD, 'min-h-[6rem] resize-y')}
                            value={draft.body}
                            onChange={(e) =>
                              setDraft({ ...draft, body: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label className={LABEL}>Tags (comma-separated)</label>
                          <input
                            className={FIELD}
                            value={draft.tags}
                            onChange={(e) =>
                              setDraft({ ...draft, tags: e.target.value })
                            }
                            placeholder="e.g. voice, ui"
                          />
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDraft(null)}
                            className="rounded-sm border border-ink/30 px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveDraft(full)}
                            disabled={saving || draft.body.trim().length === 0}
                            className="rounded-sm bg-mucka px-2 py-1 font-sans text-[0.75rem] font-semibold uppercase tracking-wide text-paper-cream disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap font-[var(--font-hand)] text-[0.95rem] leading-snug text-ink">
                          {full.body}
                        </p>
                        {full.tags.length > 0 ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {full.tags.map((t) => (
                              <span
                                key={t}
                                className="rounded-sm bg-ink/10 px-1.5 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide text-ink-soft"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-3 flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => beginEdit(full)}
                            className="rounded-sm border border-ink/30 px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteMemory(m.topic)}
                            disabled={saving}
                            className="rounded-sm border border-status-bad/50 bg-status-bad/10 px-2 py-1 font-sans text-[0.75rem] text-status-bad hover:bg-status-bad/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Forget
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ) : isOpen ? (
                  <p className="border-t border-ink/15 px-3 py-2 font-[var(--font-hand)] text-[0.85rem] text-ink-faint">
                    Loading…
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

interface FilterChipProps {
  active: boolean
  onClick: () => void
  label: string
  disabled?: boolean
}

function FilterChip({
  active,
  onClick,
  label,
  disabled
}: FilterChipProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'rounded-sm border px-2 py-0.5 font-sans text-[0.72rem] uppercase tracking-wide',
        active
          ? 'border-mucka bg-mucka/15 text-mucka-deep'
          : 'border-ink/20 text-ink-soft hover:bg-paper-shadow',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      {label}
    </button>
  )
}
