import { useState } from 'react'
import type { PendingAnswerResult, PendingItem, PendingQuestion } from '@shared/types'
import type { QueueEntry } from '../state/NeedsYouContext'
import { useNeedsYou } from '../state/NeedsYouContext'
import { useAgentsState } from '../state/AgentsContext'
import { useJobs } from '../state/JobsContext'
import { TERMINAL_FONT, THEME } from './terminalTheme'

interface NeedsYouCardProps {
  entry: QueueEntry
  place: number
  now: number
}

function waited(since: number, now: number): string {
  const mins = Math.floor((now - since) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

const DIM = 'var(--dirty-grey)'

/**
 * One agent or job waiting on Tom, drawn the way Claude's own prompt
 * looks in the terminal: numbered options, each with its explanation
 * underneath, because the label alone is rarely enough to decide on.
 * Permission prompts and single-choice questions are answered here;
 * anything else (several picks, a typed answer) opens the terminal,
 * which can always still answer.
 */
export function NeedsYouCard({ entry, place, now }: NeedsYouCardProps): React.JSX.Element {
  const { agents } = useAgentsState()
  const { focusTerminal } = useNeedsYou()
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { jobs } = useJobs()
  const agent = agents.find((a) => a.id === entry.agentId)
  const job = jobs.find((j) => j.id === entry.jobId)
  const name = agent?.displayName ?? job?.title ?? entry.key
  const p = entry.pending
  const first = place === 1
  const openTerminal = (): void => {
    if (entry.terminalId) focusTerminal(entry.terminalId)
  }

  const send = async (run: () => Promise<PendingAnswerResult>): Promise<void> => {
    setBusy(true)
    setNote(null)
    const result = await run()
    setBusy(false)
    if (!result.ok) {
      setNote(
        result.reason === 'stale'
          ? 'Already answered in the terminal, or Claude moved on.'
          : "That answer didn't fit the question. Use the terminal."
      )
    }
  }

  return (
    <div
      className="flex flex-col gap-2 px-3 py-2.5"
      style={{
        background: THEME.background,
        color: THEME.foreground,
        fontFamily: TERMINAL_FONT,
        fontSize: 12,
        lineHeight: 1.45,
        boxShadow: first ? 'inset 0 0 0 1px var(--orange)' : `inset 0 0 0 1px ${THEME.brightBlack}`
      }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span style={{ color: first ? 'var(--orange)' : DIM }}>{place}</span>
        <span className="truncate" style={{ fontWeight: 700 }}>
          {name}
        </span>
        <span className="shrink-0" style={{ color: DIM }}>
          {p
            ? `${p.kind === 'question' ? 'asks' : 'needs a yes'} · ${waited(p.since, now)}`
            : agent?.needsAttention
              ? 'flagged'
              : 'waiting for you'}
        </span>
        {entry.terminalId ? (
          <button
            type="button"
            onClick={openTerminal}
            className="ml-auto shrink-0 px-1 hover:bg-[rgba(234,233,232,0.1)]"
            style={{ fontFamily: 'inherit', color: DIM }}
          >
            open terminal →
          </button>
        ) : null}
      </div>

      {p ? (
        p.kind === 'permission' ? (
          <PermissionBody item={p} busy={busy} onSend={send} />
        ) : (
          <QuestionBody item={p} busy={busy} onSend={send} onType={openTerminal} />
        )
      ) : (
        <span style={{ color: DIM }}>
          {agent?.needsAttention
            ? (agent.attentionReason ?? 'Flagged for your attention.')
            : 'Finished its turn and is waiting for its next instruction.'}
        </span>
      )}

      {note ? <span style={{ color: DIM }}>{note}</span> : null}
    </div>
  )
}

/** One numbered choice, as Claude's prompt shows it. */
function Option({
  n,
  label,
  description,
  picked,
  disabled,
  onClick
}: {
  n: number
  label: string
  description?: string | null
  picked?: boolean
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex w-full gap-1.5 px-1 py-0.5 text-left hover:bg-[rgba(234,233,232,0.08)] disabled:opacity-50"
      style={{
        fontFamily: 'inherit',
        color: 'inherit',
        background: picked ? 'rgba(234, 233, 232, 0.16)' : undefined
      }}
    >
      <span className="w-3 shrink-0" style={{ color: picked ? THEME.foreground : 'transparent' }}>
        ❯
      </span>
      <span className="flex min-w-0 flex-col">
        <span>
          {n}. {label}
        </span>
        {description ? <span style={{ color: DIM }}>{description}</span> : null}
      </span>
    </button>
  )
}

interface BodyProps {
  item: PendingItem
  busy: boolean
  onSend: (run: () => Promise<PendingAnswerResult>) => Promise<void>
}

function PermissionBody({ item, busy, onSend }: BodyProps): React.JSX.Element {
  const { answer } = useNeedsYou()
  const reply = (behavior: 'allow' | 'deny', always: boolean): void => {
    void onSend(() =>
      answer({ id: item.id, terminalId: item.terminalId, kind: 'permission', behavior, always })
    )
  }
  return (
    <div className="flex flex-col gap-1">
      <span style={{ fontWeight: 700 }}>{item.tool}</span>
      <code
        className="block whitespace-pre-wrap break-words px-2 py-1"
        style={{ background: THEME.black, fontFamily: 'inherit' }}
      >
        {item.summary}
      </code>
      <span className="pt-1">Do you want to proceed?</span>
      <Option n={1} label="Yes" disabled={busy} onClick={() => reply('allow', false)} />
      {item.alwaysLabel ? (
        <Option
          n={2}
          label={item.alwaysLabel}
          disabled={busy}
          onClick={() => reply('allow', true)}
        />
      ) : null}
      <Option
        n={item.alwaysLabel ? 3 : 2}
        label="No"
        disabled={busy}
        onClick={() => reply('deny', false)}
      />
    </div>
  )
}

function QuestionBody({
  item,
  busy,
  onSend,
  onType
}: BodyProps & { onType: () => void }): React.JSX.Element {
  const { answer } = useNeedsYou()
  const [picks, setPicks] = useState<Record<string, string>>({})
  const answerable = item.questions.length > 0 && item.questions.every((q) => !q.multiSelect)
  const single = item.questions.length === 1

  const submit = (answers: Record<string, string>): void => {
    void onSend(() =>
      answer({ id: item.id, terminalId: item.terminalId, kind: 'question', answers })
    )
  }

  const choose = (q: PendingQuestion, label: string): void => {
    if (single) {
      submit({ [q.question]: label })
      return
    }
    setPicks((prev) => ({ ...prev, [q.question]: label }))
  }

  const complete = item.questions.every((q) => picks[q.question])

  return (
    <div className="flex flex-col gap-3">
      {item.questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-0.5">
          {q.header ? (
            <span style={{ color: DIM }}>
              {picks[q.question] ? '☒' : '☐'} {q.header}
            </span>
          ) : null}
          <span className="pb-1" style={{ fontWeight: 700 }}>
            {q.question}
          </span>
          {q.options.map((o, i) => (
            <Option
              key={o.label}
              n={i + 1}
              label={o.label}
              description={o.description}
              picked={picks[q.question] === o.label}
              disabled={busy || !answerable}
              onClick={() => choose(q, o.label)}
            />
          ))}
          <Option n={q.options.length + 1} label="Type something → terminal" onClick={onType} />
        </div>
      ))}
      {!answerable ? (
        <span style={{ color: DIM }}>This one takes several picks. Answer it in the terminal.</span>
      ) : !single ? (
        <button
          type="button"
          disabled={busy || !complete}
          onClick={() => submit(picks)}
          className="self-start px-1.5 hover:bg-[rgba(234,233,232,0.1)] disabled:opacity-40"
          style={{ fontFamily: 'inherit', color: THEME.brightWhite }}
        >
          [ ✔ submit answers ]
        </button>
      ) : null}
    </div>
  )
}
