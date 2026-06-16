// lib/app.tsx
import { Button, Frog, TextInput } from "frog";
import { serveStatic } from "frog/serve-static";
import { Hono } from "hono";
import { z as z2 } from "zod";

// lib/manifest.ts
var FARCASTER_ACCOUNT_ASSOCIATION_STUB = {
  header: "eyJhbGciOiJFUzI1NksifQ",
  payload: "eyJkb21haW4iOiJZT1VSX0RPTUFJTiJ9",
  signature: "REPLACE_WITH_SIGNED_ACCOUNT_ASSOCIATION"
};
var FARCASTER_MINIAPP_CONFIG = {
  version: "1",
  name: "SoundFrame",
  description: "Share SoundCloud tracks in Farcaster with an embedded player. Paste a link and play in-app.",
  subtitle: "SoundCloud for Farcaster",
  primaryCategory: "music",
  tags: ["music", "soundcloud", "player"],
  splashBackgroundColor: "#121212"
};
function buildFarcasterManifest(origin) {
  const base = origin.replace(/\/$/, "");
  const miniapp = {
    ...FARCASTER_MINIAPP_CONFIG,
    iconUrl: `${base}/splash.png`,
    homeUrl: `${base}/player`,
    splashImageUrl: `${base}/splash.png`
  };
  return {
    accountAssociation: FARCASTER_ACCOUNT_ASSOCIATION_STUB,
    miniapp,
    frame: miniapp
  };
}
function isFarcasterManifestRequest(request) {
  const { pathname } = new URL(request.url);
  return pathname === "/.well-known/farcaster.json" || pathname === "/api/.well-known/farcaster.json";
}
function farcasterManifestResponse(request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify(buildFarcasterManifest(origin)), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// lib/utils/soundcloud.ts
import { z } from "zod";
var SOUND_CLOUD_CANONICAL_HOSTS = /* @__PURE__ */ new Set(["soundcloud.com", "www.soundcloud.com"]);
var SOUND_CLOUD_SHORT_LINK_HOSTS = /* @__PURE__ */ new Set(["on.soundcloud.com"]);
var TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/;
var TrackIdSchema = z.string().regex(TRACK_ID_ALPHANUM_RE, {
  message: "Invalid trackId. Must be strictly alphanumeric."
});
var SoundCloudUrlSchema = z.string().url({
  message: "Invalid URL."
});
function assertSoundCloudCanonicalHostname(inputUrl) {
  if (!SOUND_CLOUD_CANONICAL_HOSTS.has(inputUrl.hostname)) {
    throw new Error("Invalid SoundCloud hostname.");
  }
}
function trimTrailingUrlPunctuation(url) {
  return url.replace(/[)\]},.!?;:]+$/, "");
}
function extractSoundCloudUrlFromText(text) {
  const normalized = text.replace(/\u200b/g, "").trim();
  const scMatches = normalized.match(/https?:\/\/(?:[\w-]+\.)*soundcloud\.com\/[^\s<>"']+/gi);
  if (scMatches?.length) {
    return trimTrailingUrlPunctuation(scMatches[scMatches.length - 1]);
  }
  const urlMatch = normalized.match(/https?:\/\/[^\s<>"']+/);
  return urlMatch ? trimTrailingUrlPunctuation(urlMatch[0]) : null;
}
async function normalizeSoundCloudInputUrl(inputUrlRaw) {
  let inputUrlStr;
  try {
    inputUrlStr = SoundCloudUrlSchema.parse(inputUrlRaw);
  } catch {
    return null;
  }
  const inputUrl = new URL(inputUrlStr);
  if (SOUND_CLOUD_CANONICAL_HOSTS.has(inputUrl.hostname)) {
    return `${inputUrl.origin}${inputUrl.pathname}`;
  }
  if (!SOUND_CLOUD_SHORT_LINK_HOSTS.has(inputUrl.hostname)) {
    return null;
  }
  try {
    const res = await fetch(inputUrlStr, {
      method: "GET",
      redirect: "follow",
      headers: { accept: "text/html" }
    });
    if (!res.ok) return null;
    const finalUrl = new URL(res.url);
    if (!SOUND_CLOUD_CANONICAL_HOSTS.has(finalUrl.hostname)) {
      return null;
    }
    return `${finalUrl.origin}${finalUrl.pathname}`;
  } catch {
    return null;
  }
}
function isOEmbedDebugEnabled() {
  return typeof process !== "undefined" && typeof process.env?.SOUNDFRAME_DEBUG_OEMBED === "string" && process.env.SOUNDFRAME_DEBUG_OEMBED === "1";
}
function logOEmbedDebug(message, data) {
  if (!isOEmbedDebugEnabled()) return;
  if (data) {
    console.log(`[soundframe:oembed] ${message}`, data);
    return;
  }
  console.log(`[soundframe:oembed] ${message}`);
}
async function resolveSoundCloudTrackIdViaOEmbed(inputUrlRaw) {
  try {
    const inputUrlStr = SoundCloudUrlSchema.parse(inputUrlRaw);
    const inputUrl = new URL(inputUrlStr);
    assertSoundCloudCanonicalHostname(inputUrl);
    const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(inputUrlStr)}&format=json`;
    const res = await fetch(oEmbedUrl, {
      method: "GET",
      headers: {
        accept: "application/json"
      }
    });
    if (!res.ok) {
      logOEmbedDebug("oEmbed request failed", {
        status: res.status,
        statusText: res.statusText,
        url: oEmbedUrl
      });
      return null;
    }
    const text = await res.text();
    if (!text.trim()) return null;
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      logOEmbedDebug("oEmbed returned non-JSON body", {
        status: res.status,
        bodyPreview: text.slice(0, 120)
      });
      return null;
    }
    const oEmbed = json;
    const html = typeof oEmbed.html === "string" ? oEmbed.html : "";
    const match = html.match(/api\.soundcloud\.com\/tracks(?:%2F|\/)([0-9]+)/) ?? html.match(/api\.soundcloud\.com%2Ftracks(?:%2F|\/)([0-9]+)/) ?? html.match(/api\.soundcloud\.com%2Ftracks%2F([0-9]+)/);
    if (!match?.[1]) return null;
    try {
      return TrackIdSchema.parse(match[1]);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
async function parseSoundCloudUrl(inputUrlRaw) {
  const canonicalUrl = await normalizeSoundCloudInputUrl(inputUrlRaw);
  if (!canonicalUrl) {
    return { ok: false, error: "unresolvable" };
  }
  const trackId = await resolveSoundCloudTrackIdViaOEmbed(canonicalUrl);
  if (!trackId) {
    return { ok: false, error: "unresolvable" };
  }
  return { ok: true, trackId };
}
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
function frameArtworkUrlFromOEmbed(thumbnailUrl) {
  return thumbnailUrl.replace(/-t\d+x\d+/gi, "-t200x200").replace(/-(?:large|original)(?=\.(?:jpg|jpeg|png|webp))/i, "-t200x200");
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

// lib/app.tsx
import { jsx, jsxs } from "frog/jsx/jsx-runtime";
var SOUND_CLOUD_ALLOWED_HOSTS = /* @__PURE__ */ new Set(["soundcloud.com", "www.soundcloud.com"]);
var TRACK_ID_ALPHANUM_RE2 = /^[A-Za-z0-9]+$/;
var LANDSCAPE_FRAME_WIDTH = 900;
var LANDSCAPE_FRAME_HEIGHT = 600;
var LANDSCAPE_FRAME_IMAGE_OPTS = {
  width: LANDSCAPE_FRAME_WIDTH,
  height: LANDSCAPE_FRAME_HEIGHT,
  embedFont: false
};
var TRANSPARENT_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0)
);
var UrlQuerySchema = z2.object({
  url: z2.string().url()
});
var PlayerTrackParamsSchema = z2.object({
  trackId: z2.string().regex(TRACK_ID_ALPHANUM_RE2)
});
var PlayerArtworkQuerySchema = z2.object({
  artwork: z2.string().url().optional()
});
function encodeArtworkQueryParam(artworkUrl) {
  const bytes = new TextEncoder().encode(artworkUrl);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
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
async function fetchSoundCloudOEmbedArtwork(inputUrlRaw) {
  const inputUrl = new URL(inputUrlRaw);
  if (!SOUND_CLOUD_ALLOWED_HOSTS.has(inputUrl.hostname)) {
    throw new Error("Invalid SoundCloud hostname.");
  }
  const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(inputUrlRaw)}&format=json`;
  try {
    const res = await fetch(oEmbedUrl, {
      method: "GET",
      headers: {
        accept: "application/json"
      }
    });
    if (!res.ok) {
      console.warn("SoundCloud oEmbed request failed:", res.status, res.statusText);
      return null;
    }
    const text = await res.text();
    if (!text.trim()) return null;
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.warn(
        "SoundCloud oEmbed returned non-JSON body:",
        text.slice(0, 120),
        parseErr instanceof Error ? parseErr.message : parseErr
      );
      return null;
    }
    const parsed = z2.object({
      thumbnail_url: z2.string().url().optional(),
      title: z2.string().optional(),
      author_name: z2.string().optional()
    }).catchall(z2.unknown()).safeParse(json);
    if (!parsed.success) return null;
    const data = parsed.data;
    return {
      thumbnailUrl: typeof data.thumbnail_url === "string" ? data.thumbnail_url : void 0,
      title: typeof data.title === "string" ? data.title : void 0,
      authorName: typeof data.author_name === "string" ? data.author_name : void 0
    };
  } catch {
    return null;
  }
}
function isValidTrackId(trackId) {
  return TRACK_ID_ALPHANUM_RE2.test(trackId);
}
var PLAYER_HOME_PATH = "/player";
var PLAYER_PATH_RE = /^\/player\/[A-Za-z0-9]+$/;
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
function handlePlayerHomeRequest(c) {
  const framePath = "/api/frame";
  return c.html(
    miniAppShellHtml(`
      <h1>SoundFrame</h1>
      <p>Paste a SoundCloud link in the <a href="${framePath}" style="color:${theme.primary}">frame</a> to load a track, or open a shared player from a cast.</p>
    `)
  );
}
function handlePlayerRequest(c) {
  const parsedParams = PlayerTrackParamsSchema.safeParse(c.req.param());
  if (!parsedParams.success) {
    return c.html(
      `<!doctype html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no" /><title>SoundFrame</title></head><body style="margin:0;background:#121212;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;">Track unavailable.</body></html>`,
      400
    );
  }
  const { trackId } = parsedParams.data;
  const artworkSrc = parseArtworkFromQuery(c.req.query("artwork"));
  const playerSrc = `${buildSoundCloudPlayerIframeUrl({
    trackId,
    colorHex: theme.primary
  })}&auto_play=false`;
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
var rootHono = new Hono();
rootHono.get(PLAYER_HOME_PATH, handlePlayerHomeRequest);
rootHono.get("/player/:trackId", handlePlayerRequest);
var app = new Frog({
  assetsPath: "/",
  basePath: "/api",
  // Supply a Hub to enable frame verification.
  // hub: neynar({ apiKey: 'NEYNAR_FROG_FM' })
  title: "SoundFrame"
});
app.hono.get("/.well-known/farcaster.json", (c) => {
  const origin = new URL(c.req.url).origin;
  c.header("Content-Type", "application/json");
  c.header("Access-Control-Allow-Origin", "*");
  return c.json(buildFarcasterManifest(origin));
});
if (serveStatic) {
  app.hono.use("/*", serveStatic({ root: "./public" }));
  app.hono.use("/icon.png", serveStatic({ path: "./public/icon.png" }));
}
app.hono.use("/frame/image", async (c, next) => {
  const imageParam = c.req.query("image");
  if (!imageParam || !imageParam.trim()) {
    return c.body(TRANSPARENT_PNG, 200, {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60"
    });
  }
  return next();
});
app.hono.get(PLAYER_HOME_PATH, handlePlayerHomeRequest);
app.hono.get("/player/:trackId", handlePlayerRequest);
var frogFetch = app.fetch.bind(app);
app.fetch = async (request, env, executionCtx) => {
  if (isFarcasterManifestRequest(request)) {
    return farcasterManifestResponse(request);
  }
  const { pathname } = new URL(request.url);
  if (pathname === PLAYER_HOME_PATH || PLAYER_PATH_RE.test(pathname)) {
    return rootHono.fetch(request, env, executionCtx);
  }
  return frogFetch(request, env, executionCtx);
};
app.frame("/frame", async (c) => {
  const queryUrl = c.req.query("url");
  const input = typeof c.inputText === "string" ? c.inputText.trim() : "";
  const queryUrlTrimmed = typeof queryUrl === "string" ? queryUrl.trim() : "";
  const inputUrlExtracted = queryUrlTrimmed ? extractSoundCloudUrlFromText(queryUrlTrimmed) ?? void 0 : input ? extractSoundCloudUrlFromText(input) ?? void 0 : void 0;
  const submittedTextWithoutUrl = !queryUrlTrimmed && Boolean(input) && !inputUrlExtracted;
  const retryTarget = typeof inputUrlExtracted === "string" ? `/frame?url=${encodeURIComponent(inputUrlExtracted)}` : "/frame";
  const origin = new URL(c.req.url).origin;
  const renderError = () => c.res({
    imageOptions: { width: LANDSCAPE_FRAME_WIDTH, height: LANDSCAPE_FRAME_HEIGHT, embedFont: true },
    image: /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          alignItems: "center",
          background: theme.background,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          width: "100%",
          textAlign: "center"
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                color: "white",
                display: "flex",
                fontSize: 62,
                fontStyle: "normal",
                fontWeight: 800,
                letterSpacing: "-0.025em",
                lineHeight: 1.2,
                padding: "0 60px"
              },
              children: "Track Not Found"
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                color: theme.primary,
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                marginTop: 18,
                padding: "0 50px"
              },
              children: "Try a different SoundCloud link"
            }
          )
        ]
      }
    ),
    intents: [/* @__PURE__ */ jsx(Button, { action: retryTarget, children: "Retry" })]
  });
  const renderLanding = () => c.res({
    imageOptions: { width: 900, height: 600, embedFont: true },
    image: /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          alignItems: "center",
          background: theme.background,
          display: "flex",
          flexDirection: "column",
          height: "100%",
          justifyContent: "center",
          width: "100%",
          textAlign: "center"
        },
        children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                color: theme.primary,
                display: "flex",
                fontSize: 30,
                fontWeight: 800,
                letterSpacing: "0.08em",
                lineHeight: 1.1
              },
              children: "SOUND FRAME"
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                color: "white",
                display: "flex",
                fontSize: 64,
                fontStyle: "normal",
                fontWeight: 800,
                letterSpacing: "-0.025em",
                lineHeight: 1.2,
                marginTop: 18,
                padding: "0 70px"
              },
              children: "Paste a SoundCloud link"
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                color: "#d4d4d4",
                display: "flex",
                fontSize: 30,
                fontWeight: 700,
                marginTop: 18,
                padding: "0 60px"
              },
              children: "Then tap Load Track to open player"
            }
          ),
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                background: theme.primary,
                borderRadius: 999,
                display: "flex",
                height: 12,
                marginTop: 30,
                width: 260
              }
            }
          )
        ]
      }
    ),
    intents: [
      /* @__PURE__ */ jsx(TextInput, { placeholder: "Paste SoundCloud URL" }),
      /* @__PURE__ */ jsx(Button, { action: "/frame", children: "Load Track" })
    ]
  });
  if (submittedTextWithoutUrl) {
    return renderError();
  }
  if (!inputUrlExtracted) {
    return renderLanding();
  }
  const queryParse = UrlQuerySchema.safeParse({ url: inputUrlExtracted });
  if (!queryParse.success) {
    return renderError();
  }
  const urlCanonical = await normalizeSoundCloudInputUrl(queryParse.data.url);
  if (!urlCanonical) {
    return renderError();
  }
  const urlRaw = urlCanonical;
  let parsed;
  try {
    parsed = await parseSoundCloudUrl(urlRaw);
  } catch {
    return renderError();
  }
  if (!parsed.ok || !isValidTrackId(parsed.trackId)) {
    return renderError();
  }
  const { trackId } = parsed;
  let frameArtworkUrl;
  try {
    const oEmbed = await fetchSoundCloudOEmbedArtwork(urlRaw);
    if (oEmbed?.thumbnailUrl) {
      frameArtworkUrl = frameArtworkUrlFromOEmbed(oEmbed.thumbnailUrl);
    }
  } catch {
  }
  const listenUrl = new URL(`/player/${trackId}`, origin);
  if (frameArtworkUrl) {
    listenUrl.searchParams.set("artwork", encodeArtworkQueryParam(frameArtworkUrl));
  }
  const listenTarget = listenUrl.toString();
  try {
    if (frameArtworkUrl) {
      return c.res({
        image: frameArtworkUrl,
        intents: [/* @__PURE__ */ jsx(Button.Link, { href: listenTarget, children: "\u25B6\uFE0F Listen" })]
      });
    }
    return c.res({
      imageOptions: { ...LANDSCAPE_FRAME_IMAGE_OPTS, embedFont: false },
      image: /* @__PURE__ */ jsx(
        "div",
        {
          style: {
            alignItems: "center",
            backgroundColor: theme.background,
            display: "flex",
            height: LANDSCAPE_FRAME_HEIGHT,
            justifyContent: "center",
            width: LANDSCAPE_FRAME_WIDTH
          },
          children: /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                background: "#1b1b1b",
                borderRadius: 12,
                height: 200,
                width: 200
              }
            }
          )
        }
      ),
      intents: [/* @__PURE__ */ jsx(Button.Link, { href: listenTarget, children: "\u25B6\uFE0F Listen" })]
    });
  } catch (err) {
    console.error("Failed to render track frame:", err);
    return renderError();
  }
});

// server/entry.prod.tsx
var config = {
  runtime: "edge"
};
var entry_prod_default = app.fetch.bind(app);
export {
  config,
  entry_prod_default as default
};
