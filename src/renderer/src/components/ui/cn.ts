export type ClassValue = string | null | undefined | false | ClassValue[]

export function cn(...args: ClassValue[]): string {
  const out: string[] = []
  for (const a of args) {
    if (!a) continue
    if (Array.isArray(a)) {
      const s = cn(...a)
      if (s) out.push(s)
    } else {
      out.push(a)
    }
  }
  return out.join(' ')
}
