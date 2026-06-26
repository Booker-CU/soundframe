import { FARCASTER_MINIAPP_CONFIG } from './manifest.js'

export type MiniAppEmbedActionType = 'launch_frame' | 'launch_miniapp'

export type MiniAppEmbed = {
  version: '1'
  imageUrl: string
  button: {
    title: string
    action: {
      type: MiniAppEmbedActionType
      name: string
      url?: string
      splashImageUrl: string
      splashBackgroundColor: string
    }
  }
}

/** Player home embed — built into static `public/player.html` at deploy time. */
export function buildPlayerHomeEmbed(origin: string): MiniAppEmbed {
  const base = origin.replace(/\/$/, '')
  return {
    version: '1',
    imageUrl: embedFallbackImageUrl(origin),
    button: {
      title: 'Load Track',
      action: {
        type: 'launch_frame',
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/player`,
        splashImageUrl: `${base}/logo.png`,
        splashBackgroundColor: FARCASTER_MINIAPP_CONFIG.splashBackgroundColor,
      },
    },
  }
}

/** Player track embed — used on `/player/:trackId` API responses. */
export function buildPlayerTrackEmbed(
  origin: string,
  trackId: string,
  imageUrl?: string
): MiniAppEmbed {
  const base = origin.replace(/\/$/, '')
  return {
    version: '1',
    imageUrl: imageUrl ?? `${base}/logo.png`,
    button: {
      title: 'Listen',
      action: {
        type: 'launch_frame',
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/player/${trackId}`,
        splashImageUrl: `${base}/logo.png`,
        splashBackgroundColor: FARCASTER_MINIAPP_CONFIG.splashBackgroundColor,
      },
    },
  }
}

/**
 * Per-page embed for Frog `/frame` HTML (landing + track cards).
 */
export function buildFramePageEmbed(
  origin: string,
  imageUrl: string,
  buttonTitle = 'Load Track',
  actionType: MiniAppEmbedActionType = 'launch_miniapp'
): MiniAppEmbed {
  const base = origin.replace(/\/$/, '')
  return {
    version: '1',
    imageUrl,
    button: {
      title: buttonTitle.slice(0, 32),
      action: {
        type: actionType,
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/frame`,
        splashImageUrl: `${base}/logo.png`,
        splashBackgroundColor: FARCASTER_MINIAPP_CONFIG.splashBackgroundColor,
      },
    },
  }
}

/** Max length enforced by Farcaster Mini App embed spec for `imageUrl`. */
const EMBED_IMAGE_URL_MAX_LENGTH = 1024

/** Stable 3:2 embed art for /frame — `public/frame-embed.png` (see bundle-api.ts). */
export function embedFallbackImageUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/frame-embed.png`
}

export function isValidEmbedImageUrl(imageUrl: string): boolean {
  return imageUrl.length > 0 && imageUrl.length <= EMBED_IMAGE_URL_MAX_LENGTH
}

export function serializeEmbedForMetaTag(embed: MiniAppEmbed): string {
  return JSON.stringify(embed).replace(/'/g, '&#39;')
}

export function embedMiniappMetaTag(embed: MiniAppEmbed): string {
  const json = serializeEmbedForMetaTag(embed)
  return `<meta name="fc:miniapp" content='${json}' />`
}

export function embedMetaTags(embed: MiniAppEmbed): string {
  const json = serializeEmbedForMetaTag(embed)
  return `${embedMiniappMetaTag(embed)}\n    <meta name="fc:frame" content='${json}' />`
}

function readMetaContent(html: string, attr: 'property' | 'name', key: string): string | undefined {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`, 'i')
  return html.match(re)?.[1]
}

/** Prefer Frog's og:image for Open Graph; use splash for fc:miniapp (length + validation). */
export function resolveFrameEmbedImageUrl(html: string, origin: string): string {
  const ogImage = readMetaContent(html, 'property', 'og:image')
  if (ogImage && isValidEmbedImageUrl(ogImage)) return ogImage
  const frameImage = readMetaContent(html, 'property', 'fc:frame:image')
  if (frameImage && isValidEmbedImageUrl(frameImage)) return frameImage
  return embedFallbackImageUrl(origin)
}

export function resolveFrameEmbedButtonTitle(html: string): string {
  return readMetaContent(html, 'property', 'fc:frame:button:1') ?? 'Load Track'
}

export function embedFramePageMetaTags(
  origin: string,
  imageUrl: string,
  buttonTitle: string
): string {
  // Match /player embed shape (launch_frame on both tags) — known working in Warpcast preview.
  return embedMetaTags(buildFramePageEmbed(origin, imageUrl, buttonTitle, 'launch_frame'))
}

export function injectFrameEmbedMeta(html: string, origin: string): string {
  if (html.includes('name="fc:miniapp"')) return html
  const imageUrl = resolveFrameEmbedImageUrl(html, origin)
  const buttonTitle = resolveFrameEmbedButtonTitle(html)
  // Inject before Frog's `property="fc:frame" vNext` so embed scrapers see miniapp metadata first.
  const tags = embedFramePageMetaTags(origin, imageUrl, buttonTitle)
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n    ${tags}`)
  }
  return `${tags}\n${html}`
}
