import { z } from 'zod'
import {
  buildFramePageEmbed,
  buildPlayerHomeEmbed,
  buildPlayerTrackEmbed,
  embedFallbackImageUrl,
  embedMetaTags,
} from './embed.js'
import {
  buildSoundCloudPlayerIframeUrl,
  extractSoundCloudUrlFromText,
  fetchTrackThumbnailUrl,
  normalizeSoundCloudInputUrl,
  parseSoundCloudUrl,
} from './utils/soundcloud.js'
import { theme } from './styles/theme.js'

const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const PlayerTrackParamsSchema = z.object({
  trackId: z.string().regex(TRACK_ID_ALPHANUM_RE),
})

const PlayerArtworkQuerySchema = z.object({
  artwork: z.string().url().optional(),
})

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

/** Prefer explicit `?artwork=`; otherwise resolve from SoundCloud oEmbed by track id. */
export async function resolvePlayerArtwork(
  trackId: string,
  artworkQuery?: string
): Promise<string | undefined> {
  const fromQuery = parseArtworkFromQuery(artworkQuery)
  if (fromQuery) return fromQuery
  return fetchTrackThumbnailUrl(trackId)
}

const ARTWORK_HERO_STYLES = `
      .artwork-wrap {
        width: 100%;
        display: flex;
        justify-content: center;
      }
      .artwork-hero {
        position: relative;
        width: min(100%, 360px);
        max-width: 360px;
        aspect-ratio: 1 / 1;
        border-radius: 12px;
        overflow: hidden;
        background:
          radial-gradient(circle at 28% 22%, rgba(255, 85, 0, 0.42), transparent 52%),
          linear-gradient(155deg, #2a1810 0%, ${theme.background} 48%, #1a1a1a 100%);
        box-shadow: inset 0 0 0 1px rgba(255, 85, 0, 0.18);
      }
      .artwork-hero::after {
        content: '';
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, transparent 62%, rgba(0, 0, 0, 0.35) 100%);
        pointer-events: none;
        z-index: 2;
      }
      .artwork-hero .artwork {
        position: absolute;
        inset: 0;
        z-index: 1;
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .artwork-hero .artwork.is-ready {
        opacity: 1;
      }
      .artwork-hero .artwork.is-broken {
        display: none;
      }
`

function renderArtworkHeroHtml(artworkSrc?: string): string {
  const img = artworkSrc
    ? `<img
          class="artwork"
          width="360"
          height="360"
          src="${artworkSrc}"
          alt="Track artwork"
          decoding="async"
          onload="this.classList.add('is-ready')"
          onerror="this.classList.add('is-broken')"
        />`
    : ''
  return `<div class="artwork-wrap"><div class="artwork-hero">${img}</div></div>`
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** Runs in <head> so ready() fires before body paint; exposes sdk for share actions. */
function farcasterReadyScript() {
  return `<script type="module">
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'
try {
  window.sdk = sdk
  await sdk.actions.ready()
} catch (err) {
  console.error('[SoundFrame] SDK init failed:', err)
}
</script>`
}

function miniAppShellHtml(body: string, headExtras = '') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"
    />
    <title>SoundFrame</title>
    ${headExtras}
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
      form {
        margin-top: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      input[type='url'] {
        width: 100%;
        border: 1px solid #333;
        border-radius: 10px;
        padding: 12px 14px;
        background: #1a1a1a;
        color: #fff;
        font-size: 16px;
      }
      button[type='submit'] {
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        background: ${theme.primary};
        color: #fff;
        font-weight: 700;
        font-size: 16px;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`
}

export function playerHomeResponse(origin?: string) {
  const headExtras = origin
    ? embedMetaTags(buildPlayerHomeEmbed(origin))
    : ''
  return htmlResponse(
    miniAppShellHtml(
      `
      <h1>SoundFrame</h1>
      <p>Open a shared player from a cast, or paste a SoundCloud link at <code>/frame</code>.</p>
    `,
      headExtras
    )
  )
}

/** Mini App HTML for GET /frame — no Frog vNext tags (required for embed preview). */
export function frameEmbedLandingResponse(origin?: string) {
  const headExtras = origin
    ? embedMetaTags(
        buildFramePageEmbed(
          origin,
          embedFallbackImageUrl(origin),
          'Load Track',
          'launch_frame'
        )
      )
    : ''
  return htmlResponse(
    miniAppShellHtml(
      `
      <h1>SoundFrame</h1>
      <p>Paste a SoundCloud link to open the player.</p>
      <form method="GET" action="/frame">
        <input name="url" type="url" placeholder="https://soundcloud.com/..." required />
        <button type="submit">Load Track</button>
      </form>
    `,
      headExtras
    )
  )
}

const FRAME_DOCUMENT_PATH_RE = /^\/(?:api\/)?frame\/?$/

/** GET/HEAD /frame — embed scrapers must not see Frog's vNext frame tags. */
export async function handleFrameDocumentRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origin = url.origin
  const rawUrl = url.searchParams.get('url')?.trim()

  if (rawUrl) {
    const extracted = extractSoundCloudUrlFromText(rawUrl)
    if (extracted) {
      const canonical = await normalizeSoundCloudInputUrl(extracted)
      if (canonical) {
        const parsed = await parseSoundCloudUrl(canonical)
        if (parsed.ok && TRACK_ID_ALPHANUM_RE.test(parsed.trackId)) {
          return Response.redirect(`${origin}/player/${parsed.trackId}`, 302)
        }
      }
    }
  }

  const response = frameEmbedLandingResponse(origin)
  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers })
  }
  return response
}

export function isFrameDocumentRequest(request: Request, pathname: string): boolean {
  return (
    FRAME_DOCUMENT_PATH_RE.test(pathname) &&
    (request.method === 'GET' || request.method === 'HEAD')
  )
}

export function playerTrackNotFoundResponse() {
  return htmlResponse(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
    400
  )
}

export function playerTrackResponse(
  trackId: string,
  artworkSrc?: string,
  origin?: string
) {
  const parsedParams = PlayerTrackParamsSchema.safeParse({ trackId })
  if (!parsedParams.success) {
    return playerTrackNotFoundResponse()
  }

  const playerSrc = `${buildSoundCloudPlayerIframeUrl({
    trackId: parsedParams.data.trackId,
    colorHex: theme.primary,
  })}&auto_play=false`
  const embedTags =
    origin != null
      ? embedMetaTags(
          buildPlayerTrackEmbed(origin, parsedParams.data.trackId, artworkSrc)
        )
      : ''

  return htmlResponse(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"
    />
    <title>SoundFrame Player</title>
    ${embedTags}
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
        position: relative;
        isolation: isolate;
        width: 100%;
        max-width: 560px;
        margin: 0 auto;
        padding: 12px 12px 24px;
      }
      ${ARTWORK_HERO_STYLES}
      .player-wrap {
        position: relative;
        z-index: 0;
        width: 100%;
        height: 166px;
        margin-top: 12px;
        overflow: hidden;
        border-radius: 12px;
      }
      .player {
        display: block;
        width: 100%;
        height: 166px;
        border: 0;
      }
      .share {
        position: relative;
        z-index: 2;
        margin-top: 14px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        background: ${theme.primary};
        color: #ffffff;
        font-weight: 700;
        font-size: 16px;
        cursor: pointer;
        pointer-events: auto;
        touch-action: manipulation;
      }
      #share-btn {
        position: relative;
        z-index: 2;
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
      ${renderArtworkHeroHtml(artworkSrc)}
      <div class="player-wrap">
        <iframe
          class="player"
          height="166"
          title="SoundCloud player"
          scrolling="no"
          allow="autoplay"
          src="${playerSrc}"
        ></iframe>
      </div>
      <button
        id="share-btn"
        class="share"
        type="button"
        onclick="window.__soundframeShare(event)"
        style="cursor: pointer; transition: background-color 0.2s ease, transform 0.1s ease;"
      >Share</button>
    </main>

    <script>
      const CAST_SHARE_TEXT = 'Listening to music on SoundFrame! 🎵 Check out this track:';
      const FRAME_EMBED_URL = 'https://soundframe.vercel.app/frame';

      function buildCastComposeUrl(text, embedUrl) {
        return (
          'https://farcaster.xyz/~/compose?text=' +
          encodeURIComponent(text) +
          '&embeds[]=' +
          encodeURIComponent(embedUrl)
        );
      }

      async function openCastCompose() {
        try {
          const embeds = [FRAME_EMBED_URL];
          if (window.sdk?.actions?.composeCast) {
            console.log('[SoundFrame] composeCast via SDK');
            await window.sdk.actions.composeCast({ text: CAST_SHARE_TEXT, embeds });
            return;
          }

          const composeUrl = buildCastComposeUrl(CAST_SHARE_TEXT, FRAME_EMBED_URL);
          console.log('[SoundFrame] opening cast intent URL:', composeUrl);
          if (window.sdk?.actions?.openUrl) {
            await window.sdk.actions.openUrl({ url: composeUrl });
          } else {
            window.location.href = composeUrl;
          }
        } catch (err) {
          console.error('[SoundFrame] openCastCompose failed:', err);
        }
      }

      function handleShareClick(event) {
        console.log('Share button clicked!');
        try {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          void openCastCompose();
        } catch (err) {
          console.error('[SoundFrame] Share click handler failed:', err);
        }
      }

      window.__soundframeShare = handleShareClick;
    </script>
  </body>
</html>`)
}

/** Handle /api/player and /api/player/:trackId (and /player rewrites). */
export async function handlePlayerRouteRequest(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const subpath = url.pathname.replace(/^\/api\/player\/?/, '').replace(/^\/player\/?/, '')

  if (!subpath) {
    return playerHomeResponse(origin)
  }

  const trackId = subpath.split('/')[0] ?? ''
  const artworkSrc = await resolvePlayerArtwork(
    trackId,
    url.searchParams.get('artwork') ?? undefined
  )
  return playerTrackResponse(trackId, artworkSrc, origin)
}
