import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

// `docs/plan.md`, `src/main/index.ts:42`, `/Users/tom/x.md`. A slash and an
// extension are both required, so prose never matches. The lookbehind stops
// a match starting inside a URL or a longer path.
const PATH =
  /(?<![\w./@:~-])(?:\/|\.{1,2}\/)?(?:[\w@.-]+\/)+[\w@.-]*\w\.[A-Za-z][A-Za-z0-9]{0,7}(?::\d+){0,2}(?![\w/])/g

/** The line's text, plus the 1-based column each UTF-16 unit of it sits in (wide glyphs take two). */
function readLine(line: IBufferLine, cols: number): { text: string; colOf: number[] } {
  let text = ''
  const colOf: number[] = []
  for (let x = 0; x < cols; x++) {
    const cell = line.getCell(x)
    if (!cell || cell.getWidth() === 0) continue
    const chars = cell.getChars() || ' '
    for (let i = 0; i < chars.length; i++) colOf.push(x + 1)
    text += chars
  }
  return { text, colOf }
}

/**
 * Claude Code prints the files it names as plain coloured text, not links,
 * so the terminal finds them itself. ⌘-click opens one; a relative path is
 * resolved against `rootOf()`, the worktree the terminal's Claude runs in.
 */
export function fileLinkProvider(
  term: Terminal,
  rootOf: () => string | null,
  open: (absolutePath: string) => void
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)
      if (!line) return callback(undefined)
      const { text, colOf } = readLine(line, term.cols)
      const links: ILink[] = []
      for (const match of text.matchAll(PATH)) {
        const start = match.index
        const raw = match[0]
        const path = raw.replace(/(?::\d+)+$/, '')
        links.push({
          range: {
            start: { x: colOf[start], y },
            end: { x: colOf[start + raw.length - 1], y }
          },
          text: raw,
          activate(event) {
            if (!(event.metaKey || event.ctrlKey)) return
            if (path.startsWith('/')) return open(path)
            const root = rootOf()
            if (root) open(`${root.replace(/\/+$/, '')}/${path.replace(/^\.\//, '')}`)
          }
        })
      }
      callback(links.length > 0 ? links : undefined)
    }
  }
}
