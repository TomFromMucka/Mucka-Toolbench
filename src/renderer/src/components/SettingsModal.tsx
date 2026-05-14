import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { AgentConfig, AgentUpdate } from '@shared/types'
import { Clipboard } from './Clipboard'

interface SettingsModalProps {
  open: boolean
  agents: AgentConfig[]
  onClose: () => void
  onSave: (patch: AgentUpdate) => Promise<void>
}

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

const FIELD =
  'w-full rounded-sm border border-ink/20 bg-paper-cream px-2 py-1 font-mono text-[0.82rem] text-ink focus:border-mucka focus:outline-none focus:ring-1 focus:ring-mucka'

const LABEL =
  'block text-[0.7rem] uppercase tracking-[0.16em] text-ink-faint font-sans'

export function SettingsModal({
  open,
  agents,
  onClose,
  onSave
}: SettingsModalProps): React.JSX.Element | null {
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setDrafts(agents.map(toDraft))
  }, [open, agents])

  if (!open) return null

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
          subtitle="agent worktrees & commands"
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
          <div className="max-h-[78vh] overflow-y-auto px-5 py-4">
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
          </div>
        </Clipboard>
      </div>
    </div>
  )
}
