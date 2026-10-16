#!/usr/bin/env node
/**
 * Install the Needs-you hook for Claude Code on this machine.
 *
 *   npm run hooks:install            show what would change
 *   npm run hooks:install -- --apply copy the script and update settings
 *
 * Copies scripts/claude-hooks/mucka-pending.sh to ~/.claude/ and wires it
 * into ~/.claude/settings.json as the PermissionRequest hook plus the
 * PostToolUse / Stop / UserPromptSubmit hooks that clear it, plus Pre/PostToolUse
 * hooks that tell mucka-agent-state.sh a Claude is working again. Also copies
 * mucka-job.sh, which a job's Claude runs to start a spin-off job Tom said yes to. Hooks are
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
const claudeDir = join(homedir(), '.claude')
const target = join(claudeDir, 'mucka-pending.sh')
// mucka-job.sh is no hook: a job's Claude runs it to propose a spin-off job.
const SCRIPTS = ['mucka-pending.sh', 'mucka-job.sh'].map((name) => ({
  source: join(here, 'claude-hooks', name),
  target: join(claudeDir, name)
}))
const settingsPath = join(claudeDir, 'settings.json')

const stateScript = join(claudeDir, 'mucka-agent-state.sh')

// The hook waits up to 580s for Tom; give it the full default window.
const WANTED = [
  { event: 'PermissionRequest', matcher: '', command: `${target} permission`, timeout: 600 },
  { event: 'PostToolUse', matcher: '', command: `${target} clear` },
  { event: 'Stop', command: `${target} clear` },
  { event: 'UserPromptSubmit', command: `${target} clear` },
  // A Claude that was waiting on Tom goes back to work the moment he
  // answers in its terminal, and the next tool call is the first sign.
  // Without these its state stays "waiting" until the turn ends, and the
  // job sits in the board's Waiting lane while it's busy.
  ...(existsSync(stateScript)
    ? [
        { event: 'PreToolUse', matcher: '', command: `${stateScript} --activity working` },
        { event: 'PostToolUse', matcher: '', command: `${stateScript} --activity working` }
      ]
    : [])
]

const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
settings.hooks ??= {}

const changes = []

// `mucka-job.sh start` starts a job, so it gets no allow rule: the Claude
// asks Tom first, and its run is checked like any other command. The rules
// an older install added for `propose` (which only queued a proposal) go.
const jobScript = join(claudeDir, 'mucka-job.sh')
const retired = [`Bash(${jobScript} propose:*)`, 'Bash(~/.claude/mucka-job.sh propose:*)']
const allow = settings.permissions?.allow
if (Array.isArray(allow)) {
  for (const rule of retired) {
    if (!allow.includes(rule)) continue
    allow.splice(allow.indexOf(rule), 1)
    changes.push(`removing permission: ${rule}`)
  }
}
for (const want of WANTED) {
  const { command } = want
  const groups = (settings.hooks[want.event] ??= [])
  const present = groups.some((g) => (g.hooks ?? []).some((h) => h.command === command))
  if (present) continue
  const hook = { type: 'command', command, ...(want.timeout ? { timeout: want.timeout } : {}) }
  groups.push(want.matcher === undefined ? { hooks: [hook] } : { matcher: want.matcher, hooks: [hook] })
  changes.push(`${want.event}: ${command}`)
}

const changedScripts = SCRIPTS.filter(
  ({ source, target }) =>
    !existsSync(target) || readFileSync(target, 'utf8') !== readFileSync(source, 'utf8')
)

if (changedScripts.length === 0 && changes.length === 0) {
  console.log('Needs-you hook already installed and up to date.')
  process.exit(0)
}

for (const { source, target } of changedScripts) {
  console.log(`${apply ? 'Copying' : 'Would copy'} ${source} → ${target}`)
}
for (const c of changes) {
  const removing = c.startsWith('removing ')
  const verb = removing ? (apply ? 'Removing' : 'Would remove') : apply ? 'Adding' : 'Would add'
  console.log(`${verb} ${removing ? c.slice('removing '.length) : c}`)
}

if (!apply) {
  console.log('\nNothing written. Re-run with `npm run hooks:install -- --apply` to install.')
  process.exit(0)
}

for (const { source, target } of changedScripts) {
  copyFileSync(source, target)
  chmodSync(target, 0o755)
}
if (changes.length > 0) {
  if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.bak`)
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`Updated ${settingsPath} (previous copy kept as settings.json.bak).`)
}
console.log('Done. Claude sessions started from now on pick it up.')
