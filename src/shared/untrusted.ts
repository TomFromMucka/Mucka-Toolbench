/**
 * Mucka reads text she did not write and Tom did not type — worker-agent
 * terminal output, Sentry titles, PR diffs. Any of it can carry
 * instructions aimed at her. Fence it so the prompt's untrusted-content
 * rule has an unambiguous boundary to point at, and neuter a body that
 * tries to close the fence early.
 */

const OPEN = '<<<untrusted'
const CLOSE = '<<<end untrusted>>>'

export function fenceUntrusted(label: string, body: string): string {
  const safeBody = body.split(CLOSE).join('<<<end untrusted (escaped)>>>')
  return `${OPEN} ${label}>>>\n${safeBody}\n${CLOSE}`
}
