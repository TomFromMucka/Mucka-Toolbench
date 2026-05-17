import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type {
  AgentConfig,
  AgentUpdate,
  Memory,
  MemoryListItem,
  MemoryType,
  UpdaterStatus
} from '@shared/types'
import {
  SECRET_DEFS,
  type SecretCategory,
  type SecretDef,
  type SecretId,
  type SecretStatus,
  type SecretTestResult
} from '@shared/secrets'
import type { CredentialSummary } from '@shared/credentials'
import { Clipboard } from './Clipboard'

interface SettingsModalProps {
  open: boolean
  agents: AgentConfig[]
  onClose: () => void
  onSave: (patch: AgentUpdate) => Promise<void>
}

type Tab = 'agents' | 'keys' | 'credentials' | 'memory' | 'updates'

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
          subtitle={
            tab === 'agents'
              ? 'agent worktrees & commands'
              : tab === 'keys'
                ? 'api keys & tokens (encrypted at rest)'
                : tab === 'credentials'
                  ? 'site logins — right-click insert in preview panes'
                  : tab === 'memory'
                    ? "Mucka's long-term memory"
                    : 'app version + updates'
          }
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
            ) : tab === 'keys' ? (
              <KeysTab />
            ) : tab === 'credentials' ? (
              <CredentialsTab />
            ) : tab === 'memory' ? (
              <MemoryTab />
            ) : (
              <UpdatesTab />
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
    { id: 'keys', label: 'API Keys' },
    { id: 'credentials', label: 'Credentials' },
    { id: 'memory', label: 'Memory' },
    { id: 'updates', label: 'Updates' }
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

/* ─── API Keys tab ───────────────────────────────────────────────────── */

const CATEGORY_LABEL: Record<SecretCategory, string> = {
  elevenlabs: 'ElevenLabs',
  github: 'GitHub',
  vercel: 'Vercel'
}

const CATEGORY_NOTE: Record<SecretCategory, string> = {
  elevenlabs: 'Voice mode. Without an API key, voice is disabled and text-mode Mucka still works.',
  github: 'PR + check-runs panel. Without a token, the GitHub panel shows a configure banner.',
  vercel: 'Deployment panel + deploy_to_vercel Mucka tool. Without a token, the panel shows a configure banner.'
}

const CATEGORY_ORDER: SecretCategory[] = ['elevenlabs', 'github', 'vercel']

function KeysTab(): React.JSX.Element {
  const [statuses, setStatuses] = useState<SecretStatus[] | null>(null)

  useEffect(() => {
    void window.mucka.listSecrets().then(setStatuses)
  }, [])

  const statusMap = useMemo(() => {
    const m = new Map<SecretId, SecretStatus>()
    for (const s of statuses ?? []) m.set(s.id, s)
    return m
  }, [statuses])

  const grouped = useMemo(() => {
    const g: Record<SecretCategory, SecretDef[]> = {
      elevenlabs: [],
      github: [],
      vercel: []
    }
    for (const def of SECRET_DEFS) g[def.category].push(def)
    return g
  }, [])

  return (
    <>
      <p className="mb-4 font-[var(--font-hand)] text-[0.92rem] text-ink-soft">
        Drop API keys for the integrations you want. Values are encrypted via
        your OS keychain (macOS Keychain / Windows DPAPI) — never plain text,
        never sent anywhere except the relevant API. <code className="rounded-sm bg-paper-shadow/60 px-1 text-[0.8rem]">.env</code>{' '}
        still works for keys you don&apos;t set here.
      </p>

      <div className="space-y-5">
        {CATEGORY_ORDER.map((cat) => (
          <section key={cat}>
            <h3 className="mb-1 font-[var(--font-display)] text-[1.15rem] font-semibold text-ink">
              {CATEGORY_LABEL[cat]}
            </h3>
            <p className="mb-2 text-[0.78rem] text-ink-faint">{CATEGORY_NOTE[cat]}</p>
            <ul className="space-y-2">
              {grouped[cat].map((def) => (
                <SecretRow
                  key={def.id}
                  def={def}
                  status={statusMap.get(def.id)}
                  onChanged={setStatuses}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  )
}

function SecretRow({
  def,
  status,
  onChanged
}: {
  def: SecretDef
  status: SecretStatus | undefined
  onChanged: (next: SecretStatus[]) => void
}): React.JSX.Element {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'test' | 'clear' | null>(null)
  const [testResult, setTestResult] = useState<SecretTestResult | null>(null)
  const isSet = status?.set ?? false
  const placeholder = isSet && status?.last4 ? `••••••••${status.last4}` : 'not set'

  const onSave = async (): Promise<void> => {
    const trimmed = value.trim()
    if (!trimmed) return
    setSaving(true)
    setTestResult(null)
    try {
      const next = await window.mucka.setSecret(def.id, trimmed)
      onChanged(next)
      setValue('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setTestResult({ ok: false, reason: msg })
    } finally {
      setSaving(false)
    }
  }

  const onClear = async (): Promise<void> => {
    setBusy('clear')
    setTestResult(null)
    try {
      const next = await window.mucka.clearSecret(def.id)
      onChanged(next)
      setValue('')
    } finally {
      setBusy(null)
    }
  }

  const onTest = async (): Promise<void> => {
    setBusy('test')
    try {
      const r = await window.mucka.testSecret(def.id)
      setTestResult(r)
    } finally {
      setBusy(null)
    }
  }

  return (
    <li className="rounded-sm border border-ink/20 bg-paper-cream/85 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="font-sans text-[0.82rem] font-semibold text-ink">
          {def.label}
          {def.required ? (
            <span className="ml-1 text-[0.7rem] uppercase tracking-wide text-mucka-deep">
              required
            </span>
          ) : null}
        </label>
        <SourceBadge status={status} />
      </div>
      {def.hint ? (
        <p className="mt-0.5 text-[0.74rem] text-ink-faint">{def.hint}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <input
          type={def.secret ? 'password' : 'text'}
          autoComplete="off"
          spellCheck={false}
          className={FIELD}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim().length > 0) {
              void onSave()
            }
          }}
        />
        <button
          type="button"
          onClick={() => void onSave()}
          disabled={saving || value.trim().length === 0}
          className="shrink-0 rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {def.testable ? (
          <button
            type="button"
            onClick={() => void onTest()}
            disabled={!isSet || busy !== null}
            className="shrink-0 rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow disabled:opacity-40"
          >
            {busy === 'test' ? 'Testing…' : 'Test'}
          </button>
        ) : null}
        {isSet ? (
          <button
            type="button"
            onClick={() => void onClear()}
            disabled={busy !== null}
            className="shrink-0 rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow disabled:opacity-40"
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear'}
          </button>
        ) : null}
      </div>
      {testResult ? <TestResult result={testResult} /> : null}
    </li>
  )
}

function SourceBadge({ status }: { status: SecretStatus | undefined }): React.JSX.Element | null {
  if (!status || !status.set) {
    return (
      <span className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-faint">
        not set
      </span>
    )
  }
  if (status.source === 'store') {
    return (
      <span className="text-[0.66rem] uppercase tracking-[0.16em] text-status-ok">
        encrypted store
      </span>
    )
  }
  return (
    <span className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-soft">
      from .env
    </span>
  )
}

function TestResult({ result }: { result: SecretTestResult }): React.JSX.Element {
  if (result.ok) {
    return (
      <p className="mt-2 text-[0.78rem] text-status-ok">
        ✓ {result.detail ?? 'authenticated'}
      </p>
    )
  }
  return (
    <p className="mt-2 text-[0.78rem] text-status-bad">✗ {result.reason}</p>
  )
}

/* ─── Credentials tab ────────────────────────────────────────────────── */

interface CredDraft {
  label: string
  username: string
  password: string
}

function emptyDraft(): CredDraft {
  return { label: '', username: '', password: '' }
}

function CredentialsTab(): React.JSX.Element {
  const [creds, setCreds] = useState<CredentialSummary[] | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CredDraft>(emptyDraft())
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.mucka.listCredentials().then(setCreds)
  }, [])

  const startAdd = (): void => {
    setEditingId(null)
    setDraft(emptyDraft())
    setAdding(true)
  }

  const startEdit = (cred: CredentialSummary): void => {
    setAdding(false)
    setEditingId(cred.id)
    setDraft({ label: cred.label, username: cred.username, password: '' })
  }

  const cancel = (): void => {
    setAdding(false)
    setEditingId(null)
    setDraft(emptyDraft())
  }

  const onSave = async (): Promise<void> => {
    if (busy) return
    if (!draft.label.trim()) return
    setBusy(true)
    try {
      if (editingId) {
        const patch: Parameters<typeof window.mucka.updateCredential>[0] = {
          id: editingId,
          label: draft.label,
          username: draft.username
        }
        if (draft.password.length > 0) patch.password = draft.password
        const next = await window.mucka.updateCredential(patch)
        setCreds(next)
      } else {
        if (!draft.username && !draft.password) return
        const next = await window.mucka.createCredential({
          label: draft.label,
          username: draft.username,
          password: draft.password
        })
        setCreds(next)
      }
      cancel()
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string, label: string): Promise<void> => {
    if (!window.confirm(`Delete credential "${label}"?\n\nCan't be undone.`)) return
    setBusy(true)
    try {
      const next = await window.mucka.deleteCredential(id)
      setCreds(next)
      if (editingId === id) cancel()
    } finally {
      setBusy(false)
    }
  }

  const isEditing = (id: string): boolean => editingId === id

  return (
    <>
      <p className="mb-3 font-[var(--font-hand)] text-[0.92rem] text-ink-soft">
        Saved site logins for the preview panes. Right-click any input
        field inside a preview iframe → pick a credential → username (or
        password, if it&apos;s a password field) is typed in. Works on
        cross-origin sites too — the cockpit is doing the injection at
        the Electron layer, not the iframe&apos;s sandbox. Encrypted via
        your OS keychain.
      </p>

      <ul className="space-y-2">
        {(creds ?? []).map((cred) => (
          <li
            key={cred.id}
            className="rounded-sm border border-ink/20 bg-paper-cream/85 p-3"
          >
            {isEditing(cred.id) ? (
              <CredentialForm
                draft={draft}
                setDraft={setDraft}
                onSave={() => void onSave()}
                onCancel={cancel}
                busy={busy}
                editing
              />
            ) : (
              <div className="flex items-baseline justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-sans text-[0.86rem] font-semibold text-ink">
                    {cred.label}
                  </div>
                  <div className="truncate font-mono text-[0.78rem] text-ink-soft">
                    {cred.username || '(no username)'}
                    {cred.passwordLast4 ? (
                      <span className="text-ink-faint">
                        {' · ••••'}
                        {cred.passwordLast4}
                      </span>
                    ) : (
                      <span className="text-ink-faint"> · (no password)</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(cred)}
                    className="rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(cred.id, cred.label)}
                    className="rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
        {creds && creds.length === 0 && !adding ? (
          <li className="rounded-sm border border-dashed border-ink/20 bg-paper-cream/40 p-3 text-center text-[0.85rem] text-ink-faint">
            No credentials yet. Add one to start right-click-inserting in preview panes.
          </li>
        ) : null}
      </ul>

      <div className="mt-3">
        {adding ? (
          <div className="rounded-sm border border-ink/20 bg-paper-cream/85 p-3">
            <CredentialForm
              draft={draft}
              setDraft={setDraft}
              onSave={() => void onSave()}
              onCancel={cancel}
              busy={busy}
              editing={false}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={startAdd}
            className="rounded-sm border border-ink/30 bg-paper-cream px-3 py-1.5 font-sans text-[0.8rem] text-ink hover:bg-paper-shadow"
          >
            + Add credential
          </button>
        )}
      </div>
    </>
  )
}

function CredentialForm({
  draft,
  setDraft,
  onSave,
  onCancel,
  busy,
  editing
}: {
  draft: CredDraft
  setDraft: (d: CredDraft) => void
  onSave: () => void
  onCancel: () => void
  busy: boolean
  editing: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-2">
      <div>
        <label className={LABEL}>Label</label>
        <input
          className={FIELD}
          value={draft.label}
          autoFocus
          onChange={(e) => setDraft({ ...draft, label: e.target.value })}
          placeholder="e.g. Mucka prod admin"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LABEL}>Username / email</label>
          <input
            className={FIELD}
            value={draft.username}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, username: e.target.value })}
          />
        </div>
        <div>
          <label className={LABEL}>
            Password{editing ? ' (leave blank to keep current)' : ''}
          </label>
          <input
            type="password"
            className={FIELD}
            value={draft.password}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setDraft({ ...draft, password: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={busy || !draft.label.trim()}
          className="rounded-sm border border-ink/30 bg-paper-cream px-2 py-1 font-sans text-[0.75rem] text-ink hover:bg-paper-shadow disabled:opacity-40"
        >
          {busy ? 'Saving…' : editing ? 'Save changes' : 'Save'}
        </button>
      </div>
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
          className="mucka-btn mucka-btn-tertiary mucka-btn-sm"
        >
          <span className="mucka-btn-label">Cancel</span>
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
          className={clsx(
            'mucka-btn mucka-btn-primary mucka-btn-sm',
            (saving || dirtyCount === 0) && 'cursor-not-allowed opacity-50'
          )}
        >
          <span className="mucka-btn-label">
            {saving ? 'Saving…' : 'Save & restart'}
          </span>
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
                            className="mucka-btn mucka-btn-tertiary mucka-btn-sm"
                          >
                            <span className="mucka-btn-label">Cancel</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void saveDraft(full)}
                            disabled={saving || draft.body.trim().length === 0}
                            className={clsx(
                              'mucka-btn mucka-btn-primary mucka-btn-sm',
                              (saving || draft.body.trim().length === 0) &&
                                'cursor-not-allowed opacity-50'
                            )}
                          >
                            <span className="mucka-btn-label">
                              {saving ? 'Saving…' : 'Save'}
                            </span>
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
                            className="mucka-btn mucka-btn-tertiary mucka-btn-sm"
                          >
                            <span className="mucka-btn-label">Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteMemory(m.topic)}
                            disabled={saving}
                            className={clsx(
                              'mucka-btn mucka-btn-tertiary mucka-btn-tone-danger mucka-btn-sm',
                              saving && 'cursor-not-allowed opacity-50'
                            )}
                          >
                            <span className="mucka-btn-label">Forget</span>
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

/* ─── Updates tab ────────────────────────────────────────────────────── */

function UpdatesTab(): React.JSX.Element {
  const [status, setStatus] = useState<UpdaterStatus>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return window.mucka.onUpdaterStatus((s) => setStatus(s))
  }, [])

  const currentVersion = window.mucka.getCurrentAppVersion() || 'unknown'

  const handleCheck = async (): Promise<void> => {
    setBusy(true)
    try {
      const s = await window.mucka.checkForUpdates()
      setStatus(s)
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.mucka.downloadUpdate()
    } finally {
      setBusy(false)
    }
  }

  const handleInstall = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.mucka.installUpdate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-sm border border-ink/15 bg-paper-cream/60 p-3">
        <div className="text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint">
          Installed
        </div>
        <div className="mt-1 font-mono text-[0.95rem] text-ink">
          Mucka Toolbench v{currentVersion}
        </div>
      </div>

      <UpdaterStatusCard status={status} />

      <div className="flex flex-wrap gap-2">
        {status.kind === 'available' ? (
          <button
            type="button"
            onClick={() => void handleDownload()}
            disabled={busy}
            className="rounded-sm border border-mucka bg-mucka px-3 py-1.5 text-[0.78rem] font-medium text-paper-cream hover:bg-mucka-deep disabled:opacity-50"
          >
            Download v{status.version}
          </button>
        ) : status.kind === 'downloaded' ? (
          <button
            type="button"
            onClick={() => void handleInstall()}
            disabled={busy}
            className="rounded-sm border border-mucka bg-mucka px-3 py-1.5 text-[0.78rem] font-medium text-paper-cream hover:bg-mucka-deep disabled:opacity-50"
          >
            Restart and install v{status.version}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={busy || status.kind === 'checking' || status.kind === 'downloading'}
          className="rounded-sm border border-ink/30 bg-paper-cream px-3 py-1.5 text-[0.78rem] text-ink hover:bg-paper-shadow disabled:opacity-50"
        >
          {status.kind === 'checking'
            ? 'Checking…'
            : status.kind === 'downloading'
              ? 'Downloading…'
              : 'Check for updates'}
        </button>
      </div>

      <p className="text-[0.72rem] leading-snug text-ink-faint">
        Updates ship from this repo's GitHub Releases. To publish a new
        version: bump <span className="font-mono">version</span> in
        package.json, then{' '}
        <span className="font-mono">npm run release:mac</span> from the
        cockpit project. The installed app picks it up next time you hit
        "Check for updates".
      </p>
    </div>
  )
}

function UpdaterStatusCard({
  status
}: {
  status: UpdaterStatus
}): React.JSX.Element | null {
  if (status.kind === 'idle') return null
  if (status.kind === 'unsupported') {
    return (
      <div className="rounded-sm border border-ink/15 bg-paper-cream/60 p-3 text-[0.78rem] text-ink-soft">
        {status.reason}
      </div>
    )
  }
  if (status.kind === 'checking') {
    return (
      <div className="rounded-sm border border-ink/15 bg-paper-cream/60 p-3 text-[0.78rem] text-ink-soft">
        Checking GitHub Releases…
      </div>
    )
  }
  if (status.kind === 'not-available') {
    return (
      <div className="rounded-sm border border-ink/15 bg-paper-cream/60 p-3 text-[0.78rem] text-ink-soft">
        You're on the latest version (v{status.currentVersion}).
      </div>
    )
  }
  if (status.kind === 'available') {
    return (
      <div className="rounded-sm border border-mucka/40 bg-mucka/10 p-3 text-[0.82rem] text-ink">
        <div className="font-medium text-mucka-deep">
          v{status.version} is available.
        </div>
        {status.releaseNotes ? (
          <div className="mt-2 whitespace-pre-wrap text-[0.74rem] leading-snug text-ink-soft">
            {status.releaseNotes.slice(0, 600)}
          </div>
        ) : null}
      </div>
    )
  }
  if (status.kind === 'downloading') {
    const pct = Math.round(status.percent ?? 0)
    return (
      <div className="rounded-sm border border-ink/15 bg-paper-cream/60 p-3 text-[0.78rem] text-ink-soft">
        Downloading v{status.version}… {pct}%
        <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-ink/10">
          <div
            className="h-full bg-mucka transition-all"
            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          />
        </div>
      </div>
    )
  }
  if (status.kind === 'downloaded') {
    return (
      <div className="rounded-sm border border-mucka/40 bg-mucka/10 p-3 text-[0.82rem] text-ink">
        <div className="font-medium text-mucka-deep">
          v{status.version} downloaded — ready to install.
        </div>
        <div className="mt-1 text-[0.74rem] text-ink-soft">
          The app will quit and relaunch when you install.
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-sm border border-status-bad/40 bg-status-bad/10 p-3 text-[0.78rem] text-ink">
      Update error: {status.message}
    </div>
  )
}
