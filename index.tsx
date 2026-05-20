import { Button, Frog, TextInput } from 'frog'
// import { neynar } from 'frog/hubs'
import { serveStatic } from 'frog/serve-static'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { FARCASTER_MANIFEST } from './api/manifest.js'
import { buildSoundCloudPlayerIframeUrl, parseSoundCloudUrl } from './api/utils/soundcloud.js'
import { theme } from './api/styles/theme.js'

const SOUND_CLOUD_ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])
const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

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
    console.log('SoundCloud API Response:', text)
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

const PLAYER_PATH_RE = /^\/player\/[A-Za-z0-9]+$/

function handlePlayerRequest(c: Context) {
  const parsedParams = PlayerTrackParamsSchema.safeParse(c.req.param())
  if (!parsedParams.success) {
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
      400
    )
  }

  const { trackId } = parsedParams.data
  const origin = new URL(c.req.url).origin
  const fallbackArtworkSrc = new URL('/icon.png', origin).toString()
  const artworkSrc = parseArtworkFromQuery(c.req.query('artwork')) ?? fallbackArtworkSrc
  const shareText = `Listening on SoundFrame: https://soundcloud.com/tracks/${trackId}`
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
        aspect-ratio: 1 / 1;
        display: block;
        object-fit: cover;
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
    </style>
  </head>
  <body>
    <main>
      <div class="artwork-wrap">
        <img
          class="artwork"
          src="${artworkSrc}"
          alt="Track artwork"
          onerror="this.onerror=null;this.src='${fallbackArtworkSrc}';"
        />
      </div>
      <iframe
        class="player"
        height="166"
        title="SoundCloud player"
        scrolling="no"
        allow="autoplay"
        src="${playerSrc}"
      ></iframe>
      <button id="shareButton" class="share" type="button">Share</button>
    </main>

    <script type="module">
      import { sdk } from 'https://cdn.jsdelivr.net/npm/@farcaster/frame-sdk@0.1.14/+esm'

      const shareText = ${JSON.stringify(shareText)}
      const shareButton = document.getElementById('shareButton')

      await sdk.actions.ready()

      shareButton?.addEventListener('click', async () => {
        await sdk.actions.composeCast({
          text: shareText,
        })
      })
    </script>
  </body>
</html>`)
}

// Root routes (outside Frog basePath `/api`) — matches vercel.json `/player` rewrite in production.
export const rootHono = new Hono()
rootHono.get('/player/:trackId', handlePlayerRequest)

export const app = new Frog({
  assetsPath: '/',
  basePath: '/api',
  // Supply a Hub to enable frame verification.
  // hub: neynar({ apiKey: 'NEYNAR_FROG_FM' })
  title: 'SoundFrame',
})

// Served at /api/.well-known/farcaster.json; root path handled in api/index.tsx fetch wrapper.
app.hono.get('/.well-known/farcaster.json', (c) => {
  c.header('Content-Type', 'application/json')
  c.header('Access-Control-Allow-Origin', '*')
  return c.json(FARCASTER_MANIFEST)
})

// Expose files in /public at the app root.
app.hono.use('/*', serveStatic({ root: './public' }))
app.hono.use('/icon.png', serveStatic({ path: './public/icon.png' }))

// Guard malformed /frame/image requests before Frog parses compressed payload.
app.hono.use('/frame/image', async (c, next) => {
  const imageParam = c.req.query('image')
  if (!imageParam || !imageParam.trim()) {
    const origin = new URL(c.req.url).origin
    return c.redirect(new URL('/icon.png', origin).toString(), 302)
  }
  return next()
})

app.hono.get('/player/:trackId', handlePlayerRequest)

const frogFetch = app.fetch.bind(app)
app.fetch = async (request, env, executionCtx) => {
  const { pathname } = new URL(request.url)
  if (PLAYER_PATH_RE.test(pathname)) {
    return rootHono.fetch(request, env, executionCtx)
  }
  return frogFetch(request, env, executionCtx)
}

app.frame('/frame', async (c) => {
  const queryUrl = c.req.query('url')
  const inputText = typeof c.inputText === 'string' ? c.inputText.trim() : ''
  const inputUrlRaw =
    typeof queryUrl === 'string' && queryUrl.trim() ? queryUrl : inputText || undefined
  const queryParse =
    typeof inputUrlRaw === 'string' && inputUrlRaw.trim()
      ? UrlQuerySchema.safeParse({ url: inputUrlRaw })
      : null

  const retryTarget =
    typeof inputUrlRaw === 'string'
      ? `/frame?url=${encodeURIComponent(inputUrlRaw)}`
      : '/frame'
  const origin = new URL(c.req.url).origin

  const renderError = () =>
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
        <Button
          action={`/frame?url=${encodeURIComponent('https://soundcloud.com/forss/flickermood')}`}
        >
          Try Demo Track
        </Button>,
      ],
    })

  if (!queryParse) {
    return renderLanding()
  }

  if (!queryParse.success) {
    return renderError()
  }

  const urlRaw = queryParse.data.url
  const inputUrl = new URL(urlRaw)
  if (!SOUND_CLOUD_ALLOWED_HOSTS.has(inputUrl.hostname)) {
    return renderError()
  }

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
  const placeholderUrl = new URL('/icon.png', origin).toString()

  let artworkUrl = placeholderUrl
  try {
    const oEmbed = await fetchSoundCloudOEmbedArtwork(urlRaw)
    if (oEmbed?.thumbnailUrl) {
      artworkUrl = oEmbed.thumbnailUrl
    }
  } catch {
    // Fallback to local placeholder if oEmbed fetch fails.
  }

  // PRD player route is `/player/:trackId` (rewritten to `/api/player/:trackId` in vercel.json).
  // Button.Link opens the webview; Button.action would POST and expect frame JSON (crashes on "Not Found").
  const listenUrl = new URL(`/player/${trackId}`, origin)
  if (artworkUrl !== placeholderUrl) {
    listenUrl.searchParams.set('artwork', encodeArtworkQueryParam(artworkUrl))
  }
  const listenTarget = listenUrl.toString()

  try {
    return c.res({
      imageOptions: { width: 900, height: 600, embedFont: false },
      image: (
        <div
          style={{
            background: 'black',
            alignItems: 'center',
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            overflow: 'hidden',
            width: '100%',
          }}
        >
          <img
            alt='SoundFrame artwork'
            src={artworkUrl}
            style={{
              height: '100%',
              objectFit: 'contain',
              objectPosition: 'center',
              width: '100%',
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

