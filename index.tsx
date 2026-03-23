import { Button, Frog, TextInput } from 'frog'
// import { neynar } from 'frog/hubs'
import { z } from 'zod'
import { parseSoundCloudUrl } from './api/utils/soundcloud.js'
import { theme } from './api/styles/theme.js'

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

    if (!res.ok) return null

    const text = await res.text()
    console.log('SoundCloud API Response:', text)
    if (!text.trim()) return null

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
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

export const app = new Frog({
  assetsPath: '/',
  basePath: '/api',
  // Supply a Hub to enable frame verification.
  // hub: neynar({ apiKey: 'NEYNAR_FROG_FM' })
  title: 'SoundFrame',
})

// Guard malformed /frame/image requests before Frog parses compressed payload.
app.hono.use('/frame/image', async (c, next) => {
  const imageParam = c.req.query('image')
  if (!imageParam || !imageParam.trim()) {
    const origin = new URL(c.req.url).origin
    return c.redirect(new URL('/icon.png', origin).toString(), 302)
  }
  return next()
})

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

  // PRD specifies the player webview at /player/:trackId (root path).
  // Use an absolute URL so Frog doesn't prefix it with `basePath` (/api).
  const listenTarget = `${origin}/player/${trackId}`

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
    intents: [<Button action={listenTarget}>▶️ Listen</Button>],
  })
})

