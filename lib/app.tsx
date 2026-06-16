import { Button, Frog, TextInput } from 'frog'
// import { neynar } from 'frog/hubs'
import { serveStatic } from 'frog/serve-static'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  buildFarcasterManifest,
  farcasterManifestResponse,
  isFarcasterManifestRequest,
} from './manifest.js'
import {
  buildSoundCloudPlayerIframeUrl,
  extractSoundCloudUrlFromText,
  frameArtworkUrlFromOEmbed,
  normalizeSoundCloudInputUrl,
  parseSoundCloudUrl,
} from './utils/soundcloud.js'
import { theme } from './styles/theme.js'

const SOUND_CLOUD_ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])
const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

/** Match landing frame (900×600) so the pre-load flash is not a huge 1:1 square. */
const LANDSCAPE_FRAME_WIDTH = 900
const LANDSCAPE_FRAME_HEIGHT = 600
const LANDSCAPE_FRAME_IMAGE_OPTS = {
  width: LANDSCAPE_FRAME_WIDTH,
  height: LANDSCAPE_FRAME_HEIGHT,
  embedFont: false,
} as const

/** Avoid flashing a full-size icon when Frog image generation is not ready yet. */
const TRANSPARENT_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
)

const UrlQuerySchema = z.object({
  url: z.string().url(),
})

const PlayerTrackParamsSchema = z.object({
  trackId: z.string().regex(TRACK_ID_ALPHANUM_RE),
})

const PlayerArtworkQuerySchema = z.object({
  artwork: z.string().url().optional(),
})

/** Base64url so Vite dev does not 404 on `?artwork=https://...` in the request URL. */
function encodeArtworkQueryParam(artworkUrl: string): string {
  const bytes = new TextEncoder().encode(artworkUrl)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeArtworkQueryParam(param: string): string | undefined {
  const trimmed = param.trim()
  if (!trimmed) return undefined
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/')
    const padLength = (4 - (normalized.length % 4)) % 4
    const padded = normalized + '='.repeat(padLength)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

function parseArtworkFromQuery(param: string | undefined): string | undefined {
  if (!param?.trim()) return undefined
  const decoded = decodeArtworkQueryParam(param)
  const parsed = PlayerArtworkQuerySchema.safeParse({ artwork: decoded })
  return parsed.success ? parsed.data.artwork : undefined
}

type OEmbedResponse = {
  thumbnail_url?: string
  title?: string
  author_name?: string
  [key: string]: unknown
}

async function fetchSoundCloudOEmbedArtwork(inputUrlRaw: string): Promise<{
  thumbnailUrl?: string
  title?: string
  authorName?: string
} | null> {
  // Guardrail: hostname validation before any fetch.
  const inputUrl = new URL(inputUrlRaw)
  if (!SOUND_CLOUD_ALLOWED_HOSTS.has(inputUrl.hostname)) {
    throw new Error('Invalid SoundCloud hostname.')
  }

  const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(inputUrlRaw)}&format=json`
  try {
    const res = await fetch(oEmbedUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })

    if (!res.ok) {
      console.warn('SoundCloud oEmbed request failed:', res.status, res.statusText)
      return null
    }

    const text = await res.text()
    if (!text.trim()) return null

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch (parseErr) {
      console.warn(
        'SoundCloud oEmbed returned non-JSON body:',
        text.slice(0, 120),
        parseErr instanceof Error ? parseErr.message : parseErr
      )
      return null
    }

    const parsed = z
      .object({
        thumbnail_url: z.string().url().optional(),
        title: z.string().optional(),
        author_name: z.string().optional(),
      })
      .catchall(z.unknown())
      .safeParse(json)

    if (!parsed.success) return null

    const data = parsed.data as OEmbedResponse
    return {
      thumbnailUrl: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
      title: typeof data.title === 'string' ? data.title : undefined,
      authorName: typeof data.author_name === 'string' ? data.author_name : undefined,
    }
  } catch {
    return null
  }
}

function isValidTrackId(trackId: string) {
  return TRACK_ID_ALPHANUM_RE.test(trackId)
}

const PLAYER_HOME_PATH = '/player'
const PLAYER_PATH_RE = /^\/player\/[A-Za-z0-9]+$/

/** Runs in <head> so ready() fires before body paint; exposes sdk for share actions. */
function farcasterReadyScript() {
  return `<script type="module">
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'
window.sdk = sdk
await sdk.actions.ready()
</script>`
}

function miniAppShellHtml(body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"
    />
    <title>SoundFrame</title>
    ${farcasterReadyScript()}
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        background: #121212;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      main {
        max-width: 420px;
        text-align: center;
      }
      h1 {
        margin: 0 0 12px;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #c8c8c8;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`
}

function handlePlayerHomeRequest(c: Context) {
  const framePath = '/api/frame'
  return c.html(
    miniAppShellHtml(`
      <h1>SoundFrame</h1>
      <p>Paste a SoundCloud link in the <a href="${framePath}" style="color:${theme.primary}">frame</a> to load a track, or open a shared player from a cast.</p>
    `)
  )
}

function handlePlayerRequest(c: Context) {
  const parsedParams = PlayerTrackParamsSchema.safeParse(c.req.param())
  if (!parsedParams.success) {
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
      400
    )
  }

  const { trackId } = parsedParams.data
  const artworkSrc = parseArtworkFromQuery(c.req.query('artwork'))
  const playerSrc = `${buildSoundCloudPlayerIframeUrl({
    trackId,
    colorHex: theme.primary,
  })}&auto_play=false`

  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"
    />
    <title>SoundFrame Player</title>
    ${farcasterReadyScript()}
    <style>
      :root {
        color-scheme: dark;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #121212;
        color: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      main {
        width: 100%;
        max-width: 560px;
        margin: 0 auto;
        padding: 12px 12px 24px;
      }
      .artwork-wrap {
        width: 100%;
        display: flex;
        justify-content: center;
      }
      .artwork {
        width: min(100%, 360px);
        height: auto;
        max-width: 360px;
        max-height: 360px;
        aspect-ratio: 1 / 1;
        display: block;
        object-fit: cover;
        border-radius: 12px;
        background: #1b1b1b;
        opacity: 0;
        transition: opacity 0.15s ease;
      }
      .artwork.is-ready {
        opacity: 1;
      }
      .artwork-placeholder {
        width: min(100%, 360px);
        max-width: 360px;
        aspect-ratio: 1 / 1;
        border-radius: 12px;
        background: #1b1b1b;
      }
      .player {
        width: 100%;
        height: 166px;
        border: 0;
        border-radius: 12px;
        margin-top: 12px;
        overflow: hidden;
      }
      .share {
        margin-top: 14px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        background: ${theme.primary};
        color: #ffffff;
        font-weight: 700;
        font-size: 16px;
      }
      #share-btn:hover {
        background-color: #2a2a2a;
        opacity: 0.9;
      }
      #share-btn:active {
        transform: scale(0.98);
      }
    </style>
  </head>
  <body>
    <main>
      <div class="artwork-wrap">
        ${
          artworkSrc
            ? `<img
          class="artwork"
          width="360"
          height="360"
          src="${artworkSrc}"
          alt="Track artwork"
          decoding="async"
          onload="this.classList.add('is-ready')"
          onerror="this.onerror=null;this.style.visibility='hidden';"
        />`
            : '<div class="artwork-placeholder" aria-hidden="true"></div>'
        }
      </div>
      <iframe
        class="player"
        height="166"
        title="SoundCloud player"
        scrolling="no"
        allow="autoplay"
        src="${playerSrc}"
      ></iframe>
      <button
        id="share-btn"
        class="share"
        type="button"
        style="cursor: pointer; transition: background-color 0.2s ease, transform 0.1s ease;"
      >Share</button>
    </main>

    <script>
      const shareBtn = document.getElementById('share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          const currentUrl = window.location.href;
          const shareText = "Listening to a mix on SoundFrame! 🎵";
          const warpcastComposeUrl = \`https://warpcast.com/~/compose?text=\${encodeURIComponent(shareText)}&embeds[]=\${encodeURIComponent(currentUrl)}\`;

          if (window.sdk && window.sdk.actions && window.sdk.actions.openUrl) {
            window.sdk.actions.openUrl({ url: warpcastComposeUrl });
          } else {
            window.open(warpcastComposeUrl, '_blank');
          }
        });
      }
    </script>
  </body>
</html>`)
}

// Root routes (outside Frog basePath `/api`) — matches vercel.json `/player` rewrite in production.
export const rootHono = new Hono()
rootHono.get(PLAYER_HOME_PATH, handlePlayerHomeRequest)
rootHono.get('/player/:trackId', handlePlayerRequest)

export const app = new Frog({
  assetsPath: '/',
  basePath: '/api',
  // Supply a Hub to enable frame verification.
  // hub: neynar({ apiKey: 'NEYNAR_FROG_FM' })
  title: 'SoundFrame',
})

// Served at /api/.well-known/farcaster.json; root path handled in app.fetch wrapper below.
app.hono.get('/.well-known/farcaster.json', (c) => {
  const origin = new URL(c.req.url).origin
  c.header('Content-Type', 'application/json')
  c.header('Access-Control-Allow-Origin', '*')
  return c.json(buildFarcasterManifest(origin))
})

// Dev only: Edge runtime uses Vercel static output instead of Node serve-static.
if (serveStatic) {
  app.hono.use('/*', serveStatic({ root: './public' }))
  app.hono.use('/icon.png', serveStatic({ path: './public/icon.png' }))
}

// Guard malformed /frame/image requests before Frog parses compressed payload.
app.hono.use('/frame/image', async (c, next) => {
  const imageParam = c.req.query('image')
  if (!imageParam || !imageParam.trim()) {
    return c.body(TRANSPARENT_PNG, 200, {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=60',
    })
  }
  return next()
})

app.hono.get(PLAYER_HOME_PATH, handlePlayerHomeRequest)
app.hono.get('/player/:trackId', handlePlayerRequest)

// Frog mounts routes under basePath `/api`, but Farcaster requires
// `/.well-known/farcaster.json` at the domain root.
const frogFetch = app.fetch.bind(app)
app.fetch = async (request, env, executionCtx) => {
  if (isFarcasterManifestRequest(request)) {
    return farcasterManifestResponse(request)
  }
  const { pathname } = new URL(request.url)
  if (pathname === PLAYER_HOME_PATH || PLAYER_PATH_RE.test(pathname)) {
    return rootHono.fetch(request, env, executionCtx)
  }
  return frogFetch(request, env, executionCtx)
}

app.frame('/frame', async (c) => {
  const queryUrl = c.req.query('url')
  const input = typeof c.inputText === 'string' ? c.inputText.trim() : ''
  const queryUrlTrimmed = typeof queryUrl === 'string' ? queryUrl.trim() : ''
  const inputUrlExtracted = queryUrlTrimmed
    ? extractSoundCloudUrlFromText(queryUrlTrimmed) ?? undefined
    : input
      ? extractSoundCloudUrlFromText(input) ?? undefined
      : undefined
  const submittedTextWithoutUrl = !queryUrlTrimmed && Boolean(input) && !inputUrlExtracted

  const retryTarget =
    typeof inputUrlExtracted === 'string'
      ? `/frame?url=${encodeURIComponent(inputUrlExtracted)}`
      : '/frame'
  const origin = new URL(c.req.url).origin

  const renderError = () =>
    c.res({
      imageOptions: { width: LANDSCAPE_FRAME_WIDTH, height: LANDSCAPE_FRAME_HEIGHT, embedFont: true },
      image: (
        <div
          style={{
            alignItems: 'center',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'center',
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              color: 'white',
              display: 'flex',
              fontSize: 62,
              fontStyle: 'normal',
              fontWeight: 800,
              letterSpacing: '-0.025em',
              lineHeight: 1.2,
              padding: '0 60px',
            }}
          >
            Track Not Found
          </div>
          <div
            style={{
              color: theme.primary,
              display: 'flex',
              fontSize: 30,
              fontWeight: 700,
              marginTop: 18,
              padding: '0 50px',
            }}
          >
            Try a different SoundCloud link
          </div>
        </div>
      ),
      intents: [<Button action={retryTarget}>Retry</Button>],
    })

  const renderLanding = () =>
    c.res({
      imageOptions: { width: 900, height: 600, embedFont: true },
      image: (
        <div
          style={{
            alignItems: 'center',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'center',
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              color: theme.primary,
              display: 'flex',
              fontSize: 30,
              fontWeight: 800,
              letterSpacing: '0.08em',
              lineHeight: 1.1,
            }}
          >
            SOUND FRAME
          </div>
          <div
            style={{
              color: 'white',
              display: 'flex',
              fontSize: 64,
              fontStyle: 'normal',
              fontWeight: 800,
              letterSpacing: '-0.025em',
              lineHeight: 1.2,
              marginTop: 18,
              padding: '0 70px',
            }}
          >
            Paste a SoundCloud link
          </div>
          <div
            style={{
              color: '#d4d4d4',
              display: 'flex',
              fontSize: 30,
              fontWeight: 700,
              marginTop: 18,
              padding: '0 60px',
            }}
          >
            Then tap Load Track to open player
          </div>
          <div
            style={{
              background: theme.primary,
              borderRadius: 999,
              display: 'flex',
              height: 12,
              marginTop: 30,
              width: 260,
            }}
          />
        </div>
      ),
      intents: [
        <TextInput placeholder='Paste SoundCloud URL' />,
        <Button action='/frame'>Load Track</Button>,
      ],
    })

  if (submittedTextWithoutUrl) {
    return renderError()
  }

  if (!inputUrlExtracted) {
    return renderLanding()
  }

  const queryParse = UrlQuerySchema.safeParse({ url: inputUrlExtracted })
  if (!queryParse.success) {
    return renderError()
  }

  const urlCanonical = await normalizeSoundCloudInputUrl(queryParse.data.url)
  if (!urlCanonical) {
    return renderError()
  }

  const urlRaw = urlCanonical

  let parsed: Awaited<ReturnType<typeof parseSoundCloudUrl>>
  try {
    parsed = await parseSoundCloudUrl(urlRaw)
  } catch {
    return renderError()
  }

  if (!parsed.ok || !isValidTrackId(parsed.trackId)) {
    return renderError()
  }

  const { trackId } = parsed

  let frameArtworkUrl: string | undefined
  try {
    const oEmbed = await fetchSoundCloudOEmbedArtwork(urlRaw)
    if (oEmbed?.thumbnailUrl) {
      frameArtworkUrl = frameArtworkUrlFromOEmbed(oEmbed.thumbnailUrl)
    }
  } catch {
    // Frame falls back to inline placeholder (no icon.png flash).
  }

  // PRD player route is `/player/:trackId` (rewritten to `/api/player/:trackId` in vercel.json).
  // Button.Link opens the webview; Button.action would POST and expect frame JSON (crashes on "Not Found").
  const listenUrl = new URL(`/player/${trackId}`, origin)
  if (frameArtworkUrl) {
    listenUrl.searchParams.set('artwork', encodeArtworkQueryParam(frameArtworkUrl))
  }
  const listenTarget = listenUrl.toString()

  try {
    // Use the CDN URL directly — skips Frog/Satori PNG generation so the landing
    // screen does not linger as a large placeholder while /frame/image renders.
    if (frameArtworkUrl) {
      return c.res({
        image: frameArtworkUrl,
        intents: [<Button.Link href={listenTarget}>▶️ Listen</Button.Link>],
      })
    }

    return c.res({
      imageOptions: { ...LANDSCAPE_FRAME_IMAGE_OPTS, embedFont: false },
      image: (
        <div
          style={{
            alignItems: 'center',
            backgroundColor: theme.background,
            display: 'flex',
            height: LANDSCAPE_FRAME_HEIGHT,
            justifyContent: 'center',
            width: LANDSCAPE_FRAME_WIDTH,
          }}
        >
          <div
            style={{
              background: '#1b1b1b',
              borderRadius: 12,
              height: 200,
              width: 200,
            }}
          />
        </div>
      ),
      intents: [<Button.Link href={listenTarget}>▶️ Listen</Button.Link>],
    })
  } catch (err) {
    console.error('Failed to render track frame:', err)
    return renderError()
  }
})

