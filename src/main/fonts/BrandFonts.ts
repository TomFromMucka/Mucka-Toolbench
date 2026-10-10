import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol, type CustomScheme } from 'electron'

/**
 * Söhne is a licensed typeface, and this repo and its releases are public,
 * so the font files can't ship with it. The renderer asks for
 * `mucka-font://soehne/<file>.woff2`; this serves them from
 * `~/.mucka-toolbench/fonts` on a machine that has them, and a 404
 * everywhere else, where the CSS falls back to the system font.
 */
const SCHEME = 'mucka-font'
const FONT_DIR = join(homedir(), '.mucka-toolbench', 'fonts')

export const FONT_SCHEME: CustomScheme = {
  scheme: SCHEME,
  // corsEnabled: in dev the page is http://localhost, and a font from
  // another origin only loads with CORS.
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}

/** Wire the file handler. Call after app.whenReady(). */
export function installFontProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const { hostname, pathname } = new URL(request.url)
    const file = pathname.replace(/^\/+/, '')
    if (!/^[a-z0-9-]+$/.test(hostname) || !/^[A-Za-z0-9_-]+\.woff2$/.test(file)) {
      return new Response('not found', { status: 404 })
    }
    try {
      const res = await net.fetch(pathToFileURL(join(FONT_DIR, hostname, file)).toString())
      if (!res.ok) return new Response('not found', { status: 404 })
      return new Response(res.body, {
        headers: { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}
