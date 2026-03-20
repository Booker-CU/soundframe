import { Button, Frog } from 'frog'
import { devtools } from 'frog/dev'
// import { neynar } from 'frog/hubs'
import { handle } from 'frog/next'
import { serveStatic } from 'frog/serve-static'
import { z } from 'zod'
import { parseSoundCloudUrl } from './utils/soundcloud'
import { theme } from './styles/theme'

const SOUND_CLOUD_ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])
const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const UrlQuerySchema = z.object({
  url: z.string().url(),
})

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
  const inputUrl = new URL(inputUrlRaw)
  if (!SOUND_CLOUD_ALLOWED_HOSTS.has(inputUrl.hostname)) {
    throw new Error('Invalid SoundCloud hostname.')
  }

  const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(inputUrlRaw)}&format=json`
  const res = await fetch(oEmbedUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  })

  if (!res.ok) return null

  const json = (await res.json()) as unknown
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
}

function isValidTrackId(trackId: string) {
  return TRACK_ID_ALPHANUM_RE.test(trackId)
}

// Ensure we're running on Vercel Edge Runtime (no Node.js-only APIs).
export const config = {
  runtime: 'edge',
}

export const app = new Frog({
  assetsPath: '/',
  basePath: '/api',
  // Supply a Hub to enable frame verification.
  // hub: neynar({ apiKey: 'NEYNAR_FROG_FM' })
  title: 'SoundFrame',
})

app.frame('/frame', async (c) => {
  const inputUrlRaw = c.req.query('url')
  const queryParse = UrlQuerySchema.safeParse({ url: inputUrlRaw })

  const retryTarget =
    typeof inputUrlRaw === 'string'
      ? `/api/frame?url=${encodeURIComponent(inputUrlRaw)}`
      : '/api/frame'

  const renderError = () =>
    c.res({
      imageOptions: { width: 900, height: 600 }, // 3:2 aspect ratio
      image: (
        <div
          style={{
            alignItems: 'center',
            background: theme.background,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            justifyContent: 'center',
            textAlign: 'center',
            width: '100%',
          }}
        >
          <div
            style={{
              color: 'white',
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
              marginTop: 18,
              color: theme.primary,
              fontSize: 30,
              fontWeight: 700,
              padding: '0 50px',
            }}
          >
            Try a different SoundCloud link
          </div>
        </div>
      ),
      intents: [<Button action={retryTarget}>Retry</Button>],
    })

  if (!queryParse.success) {
    return renderError()
  }

  const urlRaw = queryParse.data.url

  // Guardrail: hostname validation before any fetch.
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

  // Artwork: prefer oEmbed thumbnail_url, otherwise use a branded placeholder.
  let artworkThumbnailUrl: string | undefined
  let artworkTitle: string | undefined
  try {
    const oEmbed = await fetchSoundCloudOEmbedArtwork(urlRaw)
    artworkThumbnailUrl = oEmbed?.thumbnailUrl
    artworkTitle = oEmbed?.title
  } catch {
    // If oEmbed fails for any reason, fall back to placeholder.
  }

  const origin = new URL(c.req.url).origin
  const placeholderUrl = new URL('/icon.png', origin).toString()
  const artworkUrl = artworkThumbnailUrl ?? placeholderUrl

  const listenTarget = `/api/player/${trackId}`

  return c.res({
    imageOptions: { width: 900, height: 600 }, // 3:2 aspect ratio
    image: (
      <div
        style={{
          background: theme.background,
          height: '100%',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: 44,
          }}
        >
          <div
            style={{
              borderRadius: 26,
              overflow: 'hidden',
              position: 'relative',
              width: '100%',
              height: '100%',
              background: 'black',
            }}
          >
            <img
              alt={artworkTitle ? `Artwork for ${artworkTitle}` : 'SoundFrame artwork'}
              src={artworkUrl}
              style={{
                height: '100%',
                width: '100%',
                objectFit: 'cover',
              }}
            />

            {/* Orange play overlay */}
            <div
              style={{
                alignItems: 'center',
                background: 'rgba(0,0,0,0.22)',
                display: 'flex',
                height: '100%',
                justifyContent: 'center',
                width: '100%',
              }}
            >
              <div
                style={{
                  alignItems: 'center',
                  background: theme.primary,
                  borderRadius: 999,
                  color: 'black',
                  display: 'flex',
                  height: 110,
                  justifyContent: 'center',
                  width: 110,
                  fontSize: 54,
                  lineHeight: 1,
                  fontWeight: 900,
                }}
              >
                ▶
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            left: 44,
            right: 44,
            bottom: 26,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            gap: 18,
          }}
        >
          <div
            style={{
              color: 'white',
              fontSize: 26,
              fontWeight: 800,
              maxWidth: 560,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {artworkTitle ? artworkTitle : 'SoundFrame'}
          </div>
          <div
            style={{
              color: theme.primary,
              fontSize: 26,
              fontWeight: 900,
              whiteSpace: 'nowrap',
            }}
          >
            ▶️ Listen
          </div>
        </div>
      </div>
    ),
    intents: [<Button action={listenTarget}>▶️ Listen</Button>],
  })
})

// @ts-ignore
const isEdgeFunction = typeof EdgeFunction !== 'undefined'
const isProduction = isEdgeFunction || import.meta.env?.MODE !== 'development'
devtools(app, isProduction ? { assetsPath: '/.frog' } : { serveStatic })

export const GET = handle(app)
export const POST = handle(app)
