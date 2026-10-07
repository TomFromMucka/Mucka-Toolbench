import { useState } from 'react'
import type { PendingAnswerResult, PendingItem, PendingQuestion } from '@shared/types'
import type { QueueEntry } from '../state/NeedsYouContext'
import { useNeedsYou } from '../state/NeedsYouContext'
import { useAgentsState } from '../state/AgentsContext'
import { useJobs } from '../state/JobsContext'
import { Button } from './ui/Button'

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

/**
 * One agent waiting on Tom. A permission prompt or a single-choice
 * question is answered right here. Anything the buttons can't express
 * (multi-select, typed answers) sends him to the terminal, which is always
 * one click away and always still able to answer.
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
      className="chamfer-sm flex flex-col gap-2 px-3 py-2.5"
      style={{
        background: 'var(--surface2)',
        boxShadow: first ? 'inset 0 0 0 1px var(--orange)' : 'inset 0 0 0 1px var(--border-mid)'
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="chamfer-sm px-1.5 font-mono text-[0.68rem]"
          style={
            first
              ? { background: 'var(--orange)', color: 'var(--surface2)' }
              : { boxShadow: 'inset 0 0 0 1px var(--border-mid)', color: 'var(--dirty-grey)' }
          }
        >
          {place}
        </span>
        <span
          className="truncate"
          style={{
            fontFamily: 'var(--font-soehne-breit)',
            fontWeight: 500,
            color: 'var(--van-white)'
          }}
        >
          {name}
        </span>
        <span className="t-body-sm shrink-0 text-dirty-grey">
          {p
            ? `${p.kind === 'question' ? 'asks' : 'needs a yes'} · ${waited(p.since, now)}`
            : agent?.needsAttention
              ? 'flagged'
              : 'waiting for you'}
        </span>
        {entry.terminalId ? (
          <span className="ml-auto shrink-0">
            <Button
              variant="ghost"
              size="sm"
              trailingIcon={null}
              onClick={() => entry.terminalId && focusTerminal(entry.terminalId)}
            >
              Open terminal
            </Button>
          </span>
        ) : null}
      </div>

      {p ? (
        p.kind === 'permission' ? (
          <PermissionBody item={p} busy={busy} onSend={send} />
        ) : (
          <QuestionBody item={p} busy={busy} onSend={send} />
        )
      ) : (
        <span className="t-body-sm text-ink-soft">
          {agent?.needsAttention
            ? (agent.attentionReason ?? 'Flagged for your attention.')
            : 'Finished its turn and is waiting for its next instruction.'}
        </span>
      )}

      {note ? <span className="t-body-sm text-dirty-grey">{note}</span> : null}
    </div>
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
    <>
      <code
        className="block truncate px-2 py-1 font-mono text-[0.8rem]"
        style={{ background: 'var(--surface)', color: 'var(--van-white)' }}
        title={item.summary}
      >
        {item.summary}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          trailingIcon={null}
          disabled={busy}
          onClick={() => reply('allow', false)}
        >
          Yes
        </Button>
        {item.alwaysLabel ? (
          <Button
            variant="secondary"
            size="sm"
            trailingIcon={null}
            disabled={busy}
            onClick={() => reply('allow', true)}
          >
            {item.alwaysLabel}
          </Button>
        ) : null}
        <Button
          variant="tertiary"
          size="sm"
          trailingIcon={null}
          disabled={busy}
          onClick={() => reply('deny', false)}
        >
          No
        </Button>
      </div>
    </>
  )
}

function QuestionBody({ item, busy, onSend }: BodyProps): React.JSX.Element {
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
    <div className="flex flex-col gap-2.5">
      {item.questions.map((q) => (
        <div key={q.question} className="flex flex-col gap-1.5">
          <span className="t-body-sm text-van-white">{q.question}</span>
          {answerable ? (
            <div className="flex flex-wrap gap-2">
              {q.options.map((o) => (
                <Button
                  key={o.label}
                  variant={picks[q.question] === o.label ? 'primary' : 'secondary'}
                  size="sm"
                  trailingIcon={null}
                  disabled={busy}
                  title={o.description ?? undefined}
                  onClick={() => choose(q, o.label)}
                >
                  {o.label}
                </Button>
              ))}
            </div>
          ) : (
            <span className="t-body-sm text-dirty-grey">
              {q.options.map((o) => o.label).join(' · ')}
            </span>
          )}
        </div>
      ))}
      {!answerable ? (
        <span className="t-body-sm text-dirty-grey">
          This one takes several picks. Answer it in the terminal.
        </span>
      ) : !single ? (
        <div>
          <Button
            variant="primary"
            size="sm"
            trailingIcon={null}
            disabled={busy || !complete}
            onClick={() => submit(picks)}
          >
            Send answers
          </Button>
        </div>
      ) : null}
    </div>
  )
}
