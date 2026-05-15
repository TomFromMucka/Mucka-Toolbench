import { promises as fs, statSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { app, net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'

/**
 * On-disk storage for roadmap-ticket attachments.
 *
 *   <userData>/roadmap-attachments/<cardId>/<filename>
 *
 * Renderer references them via the `mucka-asset://<cardId>/<filename>`
 * custom protocol, registered below. CSP in the renderer allows
 * `mucka-asset:` in `img-src`.
 */

const SCHEME = 'mucka-asset'

const SAFE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.heic',
  '.avif'
])

function rootDir(): string {
  return join(app.getPath('userData'), 'roadmap-attachments')
}

export function cardDir(cardId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(cardId)) {
    throw new Error('invalid card id')
  }
  return join(rootDir(), cardId)
}

async function ensureCardDir(cardId: string): Promise<string> {
  const dir = cardDir(cardId)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function sanitiseFilename(name: string): string {
  const ext = (extname(name).toLowerCase() || '.png').replace(/[^a-z0-9.]/g, '')
  const stem = basename(name, extname(name))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
  const safeStem = stem.length > 0 ? stem : 'image'
  const safeExt = SAFE_EXT.has(ext) ? ext : '.png'
  return `${safeStem}${safeExt}`
}

function uniqueFilename(dir: string, desired: string): string {
  const ext = extname(desired)
  const stem = basename(desired, ext)
  let candidate = desired
  let n = 1
  while (true) {
    try {
      statSync(join(dir, candidate))
    } catch {
      return candidate
    }
    candidate = `${stem}-${n}${ext}`
    n++
  }
}

export interface SavedAttachment {
  filename: string
  url: string
}

export async function saveImage(
  cardId: string,
  desiredName: string,
  buffer: Buffer | Uint8Array
): Promise<SavedAttachment> {
  const dir = await ensureCardDir(cardId)
  const filename = uniqueFilename(dir, sanitiseFilename(desiredName))
  await fs.writeFile(join(dir, filename), Buffer.from(buffer))
  return {
    filename,
    url: `${SCHEME}://${cardId}/${filename}`
  }
}

export async function saveImageFromPath(
  cardId: string,
  sourcePath: string
): Promise<SavedAttachment> {
  const buf = await fs.readFile(sourcePath)
  return saveImage(cardId, basename(sourcePath), buf)
}

export async function listAttachments(cardId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(cardDir(cardId))
    return entries.filter((e) => SAFE_EXT.has(extname(e).toLowerCase()))
  } catch {
    return []
  }
}

export async function deleteCardAttachments(cardId: string): Promise<void> {
  try {
    await fs.rm(cardDir(cardId), { recursive: true, force: true })
  } catch {
    /* non-fatal */
  }
}

/**
 * Register the privileged scheme before app.whenReady — required by
 * Electron so the renderer treats `mucka-asset://` URLs as standard
 * + secure (CSP, fetch, <img> all work).
 */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

/**
 * Wire the actual file handler. Call after app.whenReady().
 */
export function installAttachmentProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    try {
      const parsed = new URL(request.url)
      const id = parsed.hostname
      const segments = parsed.pathname.split('/').filter((s) => s.length > 0)
      if (!id || segments.length === 0) {
        return new Response('not found', { status: 404 })
      }
      if (!/^[A-Za-z0-9_-]+$/.test(id)) {
        return new Response('bad card id', { status: 400 })
      }
      const filename = segments[segments.length - 1]
      if (filename.includes('..') || filename.includes('/')) {
        return new Response('bad filename', { status: 400 })
      }
      const absolute = join(cardDir(id), filename)
      const fileUrl = pathToFileURL(absolute).toString()
      return net.fetch(fileUrl)
    } catch {
      return new Response('error', { status: 500 })
    }
  })
}
