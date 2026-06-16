// lib/player-pages.ts
import { z as z2 } from "zod";

// lib/utils/soundcloud.ts
import { z } from "zod";
var TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/;
var TrackIdSchema = z.string().regex(TRACK_ID_ALPHANUM_RE, {
  message: "Invalid trackId. Must be strictly alphanumeric."
});
var SoundCloudUrlSchema = z.string().url({
  message: "Invalid URL."
});
function normalizeColorHex(colorHexRaw) {
  const color = colorHexRaw.trim();
  const normalized = color.startsWith("#") ? color : `#${color}`;
  const match = /^#([0-9a-fA-F]{6})$/.exec(normalized);
  if (!match) throw new Error("Invalid color hex.");
  return `#${match[1].toLowerCase()}`;
}
function buildSoundCloudPlayerIframeUrl(params) {
  const trackId = TrackIdSchema.parse(params.trackId);
  const colorHex = normalizeColorHex(params.colorHex);
  const colorParam = `%23${colorHex.slice(1)}`;
  const apiTrackUrlParam = `https%3A//api.soundcloud.com/tracks/${trackId}`;
  return `https://w.soundcloud.com/player/?url=${apiTrackUrlParam}&color=${colorParam}`;
}

// lib/styles/theme.ts
var PRIMARY_COLOR_HEX = "#FF5500";
var SECONDARY_COLOR_HEX = "#000000";
var BACKGROUND_COLOR_HEX = "#121212";
var theme = {
  primary: PRIMARY_COLOR_HEX,
  secondary: SECONDARY_COLOR_HEX,
  background: BACKGROUND_COLOR_HEX
};

// lib/player-pages.ts
var TRACK_ID_ALPHANUM_RE2 = /^[A-Za-z0-9]+$/;
var PlayerTrackParamsSchema = z2.object({
  trackId: z2.string().regex(TRACK_ID_ALPHANUM_RE2)
});
var PlayerArtworkQuerySchema = z2.object({
  artwork: z2.string().url().optional()
});
function decodeArtworkQueryParam(param) {
  const trimmed = param.trim();
  if (!trimmed) return void 0;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const normalized = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - normalized.length % 4) % 4;
    const padded = normalized + "=".repeat(padLength);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return void 0;
  }
}
function parseArtworkFromQuery(param) {
  if (!param?.trim()) return void 0;
  const decoded = decodeArtworkQueryParam(param);
  const parsed = PlayerArtworkQuerySchema.safeParse({ artwork: decoded });
  return parsed.success ? parsed.data.artwork : void 0;
}
function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
function farcasterReadyScript() {
  return `<script type="module">
import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'
window.sdk = sdk
await sdk.actions.ready()
<\/script>`;
}
function miniAppShellHtml(body) {
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
</html>`;
}
function playerHomeResponse() {
  const framePath = "/api/frame";
  return htmlResponse(
    miniAppShellHtml(`
      <h1>SoundFrame</h1>
      <p>Paste a SoundCloud link in the <a href="${framePath}" style="color:${theme.primary}">frame</a> to load a track, or open a shared player from a cast.</p>
    `)
  );
}
function playerTrackNotFoundResponse() {
  return htmlResponse(
    `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
    400
  );
}
function playerTrackResponse(trackId, artworkQuery) {
  const parsedParams = PlayerTrackParamsSchema.safeParse({ trackId });
  if (!parsedParams.success) {
    return playerTrackNotFoundResponse();
  }
  const artworkSrc = parseArtworkFromQuery(artworkQuery);
  const playerSrc = `${buildSoundCloudPlayerIframeUrl({
    trackId: parsedParams.data.trackId,
    colorHex: theme.primary
  })}&auto_play=false`;
  return htmlResponse(`<!doctype html>
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
        ${artworkSrc ? `<img
          class="artwork"
          width="360"
          height="360"
          src="${artworkSrc}"
          alt="Track artwork"
          decoding="async"
          onload="this.classList.add('is-ready')"
          onerror="this.onerror=null;this.style.visibility='hidden';"
        />` : '<div class="artwork-placeholder" aria-hidden="true"></div>'}
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
          const shareText = "Listening to a mix on SoundFrame! \u{1F3B5}";
          const warpcastComposeUrl = \`https://warpcast.com/~/compose?text=\${encodeURIComponent(shareText)}&embeds[]=\${encodeURIComponent(currentUrl)}\`;

          if (window.sdk && window.sdk.actions && window.sdk.actions.openUrl) {
            window.sdk.actions.openUrl({ url: warpcastComposeUrl });
          } else {
            window.open(warpcastComposeUrl, '_blank');
          }
        });
      }
    <\/script>
  </body>
</html>`);
}
function handlePlayerRequest(request) {
  const url = new URL(request.url);
  const subpath = url.pathname.replace(/^\/api\/player\/?/, "").replace(/^\/player\/?/, "");
  if (!subpath) {
    return playerHomeResponse();
  }
  const trackId = subpath.split("/")[0] ?? "";
  return playerTrackResponse(trackId, url.searchParams.get("artwork") ?? void 0);
}

// server/player.prod.tsx
var config = {
  runtime: "edge"
};
var player_prod_default = handlePlayerRequest;
export {
  config,
  player_prod_default as default
};
