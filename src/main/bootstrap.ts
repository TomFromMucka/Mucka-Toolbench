import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import dotenv from 'dotenv'

/**
 * In dev (`npm run dev`) redirect userData to a separate folder so the
 * dev window doesn't fight the installed .app for the same sqlite DB,
 * scrollback files, attachments folder, etc. Both can run side-by-side
 * with independent state.
 *
 * Must happen BEFORE anything else reads `app.getPath('userData')`.
 */
function redirectDevUserData(): string | null {
  if (app.isPackaged) return null
  const devPath = join(app.getPath('appData'), 'mucka-toolbench-dev')
  mkdirSync(devPath, { recursive: true })
  app.setPath('userData', devPath)
  // eslint-disable-next-line no-console
  console.log(`[mucka] dev mode — userData → ${devPath}`)
  return devPath
}

redirectDevUserData()

/**
 * Side-effect import — runs BEFORE the rest of main loads its modules,
 * so values from `.env` are available when `getAgentConfigs`, `Mucka.ts`,
 * `MuckaTextAgent.ts`, the Vercel/GitHub pollers, etc. read
 * `process.env`.
 *
 * Two boot-time tasks:
 *  - Load `.env` from the right place — the project root in dev (`npm
 *    run dev`), or `<userData>/.env` when installed as a `.app`. The
 *    packaged build ships without secrets — Tom drops .env into
 *    userData after install.
 *  - Resolve the Claude Code CLI binary up-front so the Agent SDK can
 *    find it from the Finder-launched app (GUI launches inherit a
 *    minimal PATH that misses ~/.local/bin and similar).
 */

function loadEnv(): string | null {
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(join(app.getPath('userData'), '.env'))
    candidates.push(join(app.getPath('home'), '.mucka-toolbench', '.env'))
  } else {
    candidates.push(join(app.getAppPath(), '.env'))
  }
  for (const path of candidates) {
    if (existsSync(path)) {
      dotenv.config({ path })
      // eslint-disable-next-line no-console
      console.log(`[mucka] loaded env from ${path}`)
      return path
    }
  }
  // eslint-disable-next-line no-console
  console.log(
    `[mucka] no .env found at: ${candidates.join(', ')}. Voice + Vercel + GitHub will be disabled.`
  )
  return null
}

function resolveClaudeBinary(): string | null {
  const override = process.env.MUCKA_CLAUDE_PATH?.trim()
  if (override && existsSync(override)) return setClaudeEnv(override)

  const home = app.getPath('home')
  const candidates = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    join(home, '.local/bin/claude'),
    join(home, '.claude/local/claude'),
    join(home, '.npm-global/bin/claude'),
    join(home, '.bun/bin/claude'),
    join(home, '.volta/bin/claude')
  ]
  for (const path of candidates) {
    if (existsSync(path)) return setClaudeEnv(path)
  }
  // eslint-disable-next-line no-console
  console.log(
    '[mucka] could not find a `claude` binary — text-mode chat will surface an error until the path is set in <userData>/.env via MUCKA_CLAUDE_PATH.'
  )
  return null
}

function setClaudeEnv(path: string): string {
  process.env.CLAUDE_CODE_PATH = path
  // eslint-disable-next-line no-console
  console.log(`[mucka] using claude CLI at ${path}`)
  return path
}

loadEnv()
resolveClaudeBinary()

// electron-updater reads GH_TOKEN; the rest of the cockpit's GitHub
// integration reads GITHUB_TOKEN. Keep Tom from needing both — alias
// one to the other when only one is set.
if (!process.env.GH_TOKEN && process.env.GITHUB_TOKEN) {
  process.env.GH_TOKEN = process.env.GITHUB_TOKEN
}
if (!process.env.GITHUB_TOKEN && process.env.GH_TOKEN) {
  process.env.GITHUB_TOKEN = process.env.GH_TOKEN
}
