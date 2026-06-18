import { useCallback, useEffect, useRef } from 'react'
import { useNotesState } from '../state/NotesContext'
import { Clipboard } from './Clipboard'
import type { PanelSizeProps } from './panelSize'

const PLACEHOLDER = `Type whatever you want here — todos, ideas, links, scratch.
Saves automatically. Mucka can append lines with the note tool.`

export function NotesPanel({ size, onResize }: PanelSizeProps): React.JSX.Element {
  const { text, setText, flush } = useNotesState()
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  // Flush on unmount + window blur — belt-and-braces for autosave.
  useEffect(() => {
    const onBlur = (): void => {
      void flush()
    }
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('blur', onBlur)
      void flush()
    }
  }, [flush])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // ⌘/Ctrl-S explicitly saves.
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void flush()
      }
    },
    [flush]
  )

  return (
    <Clipboard
      title="Notes"
      subtitle="scratchpad · autosaves"
      className="min-h-0"
      size={size}
      onResize={onResize}
    >
      <textarea
        ref={taRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        spellCheck
        placeholder={PLACEHOLDER}
        className="h-full w-full resize-none border-0 px-4 py-3 t-body-lg leading-[1.55] focus:outline-none"
        style={{
          background: 'var(--surface)',
          color: 'var(--van-white)'
        }}
      />
    </Clipboard>
  )
}
