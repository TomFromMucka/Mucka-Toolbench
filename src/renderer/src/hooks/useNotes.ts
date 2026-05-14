import { useCallback, useEffect, useRef, useState } from 'react'

const SAVE_DEBOUNCE_MS = 600

interface UseNotesResult {
  text: string
  setText: (next: string) => void
  /** Persist immediately, bypassing the debounce (e.g. on blur). */
  flush: () => Promise<void>
}

/**
 * Loads the notes blob from main on mount, holds it in local state, and
 * debounces writes back to main. Also listens for `notes:update` events
 * (so a Mucka `append_note` tool call shows up live for Tom).
 */
export function useNotes(): UseNotesResult {
  const [text, setTextState] = useState('')
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
    await window.mucka.setNote(pending)
    lastSavedRef.current = pending
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

  return { text, setText, flush }
}
