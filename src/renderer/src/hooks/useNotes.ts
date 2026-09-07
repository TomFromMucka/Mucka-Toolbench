import { useCallback, useEffect, useRef, useState } from 'react'

const SAVE_DEBOUNCE_MS = 600

interface UseNotesResult {
  text: string
  setText: (next: string) => void
  /** Persist immediately, bypassing the debounce (e.g. on blur). */
  flush: () => Promise<void>
  /** Set when the last save failed; the text is still held locally and retried on the next edit. */
  saveError: string | null
}

/**
 * Loads the notes blob from main on mount, holds it in local state, and
 * debounces writes back to main. Also listens for `notes:update` events
 * (so a Mucka `append_note` tool call shows up live for Tom).
 */
export function useNotes(): UseNotesResult {
  const [text, setTextState] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const pendingRef = useRef<string | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedRef = useRef('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const initial = await window.mucka.getNote()
      if (cancelled) return
      lastSavedRef.current = initial
      setTextState(initial)
    })()

    const off = window.mucka.onNoteUpdate((value) => {
      // Only adopt remote updates if we don't have local edits queued —
      // otherwise we'd overwrite what Tom just typed.
      if (pendingRef.current !== null) return
      lastSavedRef.current = value
      setTextState(value)
    })

    return () => {
      cancelled = true
      off()
    }
  }, [])

  const flush = useCallback(async () => {
    const pending = pendingRef.current
    if (pending === null) return
    pendingRef.current = null
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    try {
      await window.mucka.setNote(pending)
      lastSavedRef.current = pending
      setSaveError(null)
    } catch (err) {
      // Keep the unsaved text queued so the next edit or ⌘S retries it,
      // and say so — a scratchpad that silently drops a line is worse
      // than one that admits it.
      if (pendingRef.current === null) pendingRef.current = pending
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const setText = useCallback(
    (next: string) => {
      setTextState(next)
      pendingRef.current = next
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void flush()
      }, SAVE_DEBOUNCE_MS)
    },
    [flush]
  )

  return { text, setText, flush, saveError }
}
