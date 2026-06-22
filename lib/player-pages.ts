import { z } from 'zod'
import {
  buildPlayerHomeEmbed,
  buildPlayerTrackEmbed,
  embedMetaTags,
} from './embed.js'
import { buildSoundCloudPlayerIframeUrl } from './utils/soundcloud.js'
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
      <p>Open a shared player from a cast. To test the frame, use <code>/frame</code> in Warpcast Developer Tools (Frame tab).</p>
    `,
      headExtras
    )
  )
}

export function playerTrackNotFoundResponse() {
  return htmlResponse(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
    400
  )
}

export function playerTrackResponse(trackId: string, artworkQuery?: string, origin?: string) {
  const parsedParams = PlayerTrackParamsSchema.safeParse({ trackId })
  if (!parsedParams.success) {
    return playerTrackNotFoundResponse()
  }

  const artworkSrc = parseArtworkFromQuery(artworkQuery)
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
export function handlePlayerRouteRequest(request: Request) {
  const url = new URL(request.url)
  const origin = url.origin
  const subpath = url.pathname.replace(/^\/api\/player\/?/, '').replace(/^\/player\/?/, '')

  if (!subpath) {
    return playerHomeResponse(origin)
  }

  const trackId = subpath.split('/')[0] ?? ''
  return playerTrackResponse(trackId, url.searchParams.get('artwork') ?? undefined, origin)
}
