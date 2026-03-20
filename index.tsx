import { Button, Frog } from 'frog'
// import { neynar } from 'frog/hubs'
import { z } from 'zod'
import { parseSoundCloudUrl } from './api/utils/soundcloud.js'
import { theme } from './api/styles/theme.js'

const SOUND_CLOUD_ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])
const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const UrlQuerySchema = z.object({
  url: z.string().url(),
})

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

app.frame('/frame', async (c) => {
  const inputUrlRaw = c.req.query('url')
  const queryParse = UrlQuerySchema.safeParse({ url: inputUrlRaw })

  const retryTarget =
    typeof inputUrlRaw === 'string'
      ? `/api/frame?url=${encodeURIComponent(inputUrlRaw)}`
      : '/api/frame'

  const renderError = () =>
    c.res({
      imageOptions: { width: 900, height: 600 },
      image: (
        <div
          style={{
            background: 'orange',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            width: '100%',
            color: 'black',
            fontSize: 72,
            fontWeight: 900,
            border: `10px solid ${theme.primary}`,
          }}
        >
          TESTING
        </div>
      ),
      intents: [<Button action={retryTarget}>Retry</Button>],
    })

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

  const listenTarget = `/api/player/${trackId}`

  return c.res({
    imageOptions: { width: 900, height: 600 },
    image: (
      <div
        style={{
          background: 'orange',
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'black',
          fontSize: 72,
          fontWeight: 900,
          border: `10px solid ${theme.primary}`,
        }}
      >
        TESTING
      </div>
    ),
    intents: [<Button action={listenTarget}>▶️ Listen</Button>],
  })
})

