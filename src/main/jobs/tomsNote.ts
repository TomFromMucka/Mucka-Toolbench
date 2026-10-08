/**
 * Tom's own direction for a job, typed when he starts it. It's his, not a
 * customer's, so it goes in plainly and first, ahead of the brief.
 */
export function withTomsNote(brief: string, note?: string | null): string {
  const text = note?.trim()
  if (!text) return brief
  return [`My note, read this first:\n${text}`, '', brief].join('\n')
}
