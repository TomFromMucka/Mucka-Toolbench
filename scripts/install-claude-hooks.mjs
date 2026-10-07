#!/usr/bin/env node
/**
 * Install the Needs-you hook for Claude Code on this machine.
 *
 *   npm run hooks:install            show what would change
 *   npm run hooks:install -- --apply copy the script and update settings
 *
 * Copies scripts/claude-hooks/mucka-pending.sh to ~/.claude/ and wires it
 * into ~/.claude/settings.json as the PermissionRequest hook plus the
 * PostToolUse / Stop / UserPromptSubmit hooks that clear it. Hooks are
 * user-wide, but the script exits at once unless $MUCKA_TERMINAL is set,
 * so only Claudes the cockpit launched are affected.
 *
 * Safe to re-run: entries already present are left alone, and the old
 * settings file is kept as settings.json.bak before any write.
 */
import { copyFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const apply = process.argv.includes('--apply')
const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, 'claude-hooks', 'mucka-pending.sh')
const claudeDir = join(homedir(), '.claude')
const target = join(claudeDir, 'mucka-pending.sh')
const settingsPath = join(claudeDir, 'settings.json')

// The hook waits up to 580s for Tom; give it the full default window.
const WANTED = [
  { event: 'PermissionRequest', matcher: '', arg: 'permission', timeout: 600 },
  { event: 'PostToolUse', matcher: '', arg: 'clear' },
  { event: 'Stop', arg: 'clear' },
  { event: 'UserPromptSubmit', arg: 'clear' }
]

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
settings.hooks ??= {}

const changes = []
for (const want of WANTED) {
  const command = `${target} ${want.arg}`
  const groups = (settings.hooks[want.event] ??= [])
  const present = groups.some((g) => (g.hooks ?? []).some((h) => h.command === command))
  if (present) continue
  const hook = { type: 'command', command, ...(want.timeout ? { timeout: want.timeout } : {}) }
  groups.push(want.matcher === undefined ? { hooks: [hook] } : { matcher: want.matcher, hooks: [hook] })
  changes.push(`${want.event}: ${command}`)
}

const scriptChanged =
  !existsSync(target) || readFileSync(target, 'utf8') !== readFileSync(source, 'utf8')

if (!scriptChanged && changes.length === 0) {
  console.log('Needs-you hook already installed and up to date.')
  process.exit(0)
}

if (scriptChanged) console.log(`${apply ? 'Copying' : 'Would copy'} ${source} → ${target}`)
for (const c of changes) console.log(`${apply ? 'Adding' : 'Would add'} hook  ${c}`)

if (!apply) {
  console.log('\nNothing written. Re-run with `npm run hooks:install -- --apply` to install.')
  process.exit(0)
}

if (scriptChanged) {
  copyFileSync(source, target)
  chmodSync(target, 0o755)
}
if (changes.length > 0) {
  if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.bak`)
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`Updated ${settingsPath} (previous copy kept as settings.json.bak).`)
}
console.log('Done. Claude sessions started from now on pick it up.')
