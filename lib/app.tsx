import { Button, Frog, TextInput } from 'frog'
// import { neynar } from 'frog/hubs'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { embedCardImageResponse } from './embed-card.js'
import {
  castTriggerPageResponse,
  handleCastTriggerResolveRequest,
  isCastTriggerPageRequest,
  isCastTriggerResolveRequest,
} from './cast-trigger.js'
import {
  composerTriggerFormPageResponse,
  handleComposerTriggerRequest,
  handleComposerTriggerResolveRequest,
  isComposerTriggerActionRequest,
  isComposerTriggerFormRequest,
  isComposerTriggerResolveRequest,
} from './composer-trigger.js'
import {
  buildFarcasterManifest,
  farcasterManifestResponse,
  isFarcasterManifestRequest,
} from './manifest.js'
import {
  extractSoundCloudUrlFromText,
  fetchTrackArtworkFromPageUrl,
  frameArtworkUrlFromOEmbed,
  isSoundCloudPlaceholderArtwork,
  normalizeSoundCloudInputUrl,
  parseSoundCloudUrl,
} from './utils/soundcloud.js'
import { theme } from './styles/theme.js'
import {
  handleFrameDocumentRequest,
  handlePlayerRouteRequest,
  isFrameDocumentRequest,
  playerHomeResponse,
  playerTrackNotFoundResponse,
  playerTrackResponse,
  resolvePlayerArtwork,
} from './player-pages.js'

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

/** Base64url so Vite dev does not 404 on `?artwork=https://...` in the request URL. */
function encodeArtworkQueryParam(artworkUrl: string): string {
  const bytes = new TextEncoder().encode(artworkUrl)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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
const API_PLAYER_HOME_PATH = '/api/player'
const API_PLAYER_PATH_RE = /^\/api\/player\/[A-Za-z0-9]+$/
function handlePlayerHomeHono(c: Context) {
  const origin = new URL(c.req.url).origin
  return playerHomeResponse(origin)
}

function handlePlayerTrackHono(c: Context) {
  const trackId = c.req.param('trackId')
  if (!trackId) {
    return playerTrackNotFoundResponse()
  }
  const origin = new URL(c.req.url).origin
  return resolvePlayerArtwork(trackId, c.req.query('artwork')).then((artworkSrc) =>
    playerTrackResponse(trackId, artworkSrc, origin)
  )
}

// Root routes (outside Frog basePath `/api`) — used when pathname is `/player` before normalization.
export const rootHono = new Hono()
rootHono.get(PLAYER_HOME_PATH, handlePlayerHomeHono)
rootHono.get('/player/:trackId', handlePlayerTrackHono)

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

// 3:2 embed preview image (fc:miniapp `imageUrl` for /frame).
app.hono.get('/embed-card', () => embedCardImageResponse())

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

app.hono.get(PLAYER_HOME_PATH, handlePlayerHomeHono)
app.hono.get('/player/:trackId', handlePlayerTrackHono)

// Frog mounts routes under basePath `/api`, but Farcaster requires
// `/.well-known/farcaster.json` at the domain root.
const frogFetch = app.fetch.bind(app)
app.fetch = async (request, env, executionCtx) => {
  if (isFarcasterManifestRequest(request)) {
    return farcasterManifestResponse(request)
  }
  const { pathname } = new URL(request.url)
  if (
    pathname === PLAYER_HOME_PATH ||
    PLAYER_PATH_RE.test(pathname) ||
    pathname === API_PLAYER_HOME_PATH ||
    API_PLAYER_PATH_RE.test(pathname)
  ) {
    if (pathname.startsWith('/api/')) {
      return handlePlayerRouteRequest(request)
    }
    return rootHono.fetch(request, env, executionCtx)
  }
  if (isFrameDocumentRequest(request, pathname)) {
    return handleFrameDocumentRequest(request)
  }
  if (isCastTriggerResolveRequest(pathname)) {
    return handleCastTriggerResolveRequest(request)
  }
  if (isComposerTriggerResolveRequest(pathname)) {
    return handleComposerTriggerResolveRequest(request)
  }
  if (isComposerTriggerFormRequest(pathname)) {
    return composerTriggerFormPageResponse(new URL(request.url).origin)
  }
  if (isComposerTriggerActionRequest(pathname)) {
    return handleComposerTriggerRequest(request)
  }
  if (isCastTriggerPageRequest(pathname)) {
    return castTriggerPageResponse(new URL(request.url).origin)
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
    if (oEmbed?.thumbnailUrl && !isSoundCloudPlaceholderArtwork(oEmbed.thumbnailUrl)) {
      frameArtworkUrl = frameArtworkUrlFromOEmbed(oEmbed.thumbnailUrl)
    }
    if (!frameArtworkUrl) {
      const fromPage = await fetchTrackArtworkFromPageUrl(urlRaw)
      if (fromPage) {
        frameArtworkUrl = frameArtworkUrlFromOEmbed(fromPage)
      }
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

