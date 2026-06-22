import { FARCASTER_MINIAPP_CONFIG } from './manifest.js'

export type MiniAppEmbed = {
  version: '1'
  imageUrl: string
  button: {
    title: string
    action: {
      type: 'launch_frame'
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
    imageUrl: `${base}/splash.png`,
    button: {
      title: 'Open SoundFrame',
      action: {
        type: 'launch_frame',
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/player`,
        splashImageUrl: `${base}/splash.png`,
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
    imageUrl: imageUrl ?? `${base}/splash.png`,
    button: {
      title: 'Listen',
      action: {
        type: 'launch_frame',
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/player/${trackId}`,
        splashImageUrl: `${base}/splash.png`,
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
  buttonTitle = 'Load Track'
): MiniAppEmbed {
  const base = origin.replace(/\/$/, '')
  return {
    version: '1',
    imageUrl,
    button: {
      title: buttonTitle.slice(0, 32),
      action: {
        type: 'launch_frame',
        name: FARCASTER_MINIAPP_CONFIG.name,
        url: `${base}/frame`,
        splashImageUrl: `${base}/splash.png`,
        splashBackgroundColor: FARCASTER_MINIAPP_CONFIG.splashBackgroundColor,
      },
    },
  }
}

export function serializeEmbedForMetaTag(embed: MiniAppEmbed): string {
  return JSON.stringify(embed).replace(/'/g, '&#39;')
}

export function embedMetaTags(embed: MiniAppEmbed): string {
  const json = serializeEmbedForMetaTag(embed)
  return `<meta name="fc:miniapp" content='${json}' />\n    <meta name="fc:frame" content='${json}' />`
}

function readMetaContent(html: string, attr: 'property' | 'name', key: string): string | undefined {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`, 'i')
  return html.match(re)?.[1]
}

/** Prefer Frog's og:image (3:2 frame art); fall back to splash. */
export function resolveFrameEmbedImageUrl(html: string, origin: string): string {
  const ogImage = readMetaContent(html, 'property', 'og:image')
  if (ogImage) return ogImage
  const frameImage = readMetaContent(html, 'property', 'fc:frame:image')
  if (frameImage) return frameImage
  return `${origin.replace(/\/$/, '')}/splash.png`
}

export function resolveFrameEmbedButtonTitle(html: string): string {
  return readMetaContent(html, 'property', 'fc:frame:button:1') ?? 'Load Track'
}

export function injectFrameEmbedMeta(html: string, origin: string): string {
  if (html.includes('name="fc:miniapp"')) return html
  const imageUrl = resolveFrameEmbedImageUrl(html, origin)
  const buttonTitle = resolveFrameEmbedButtonTitle(html)
  const tags = embedMetaTags(buildFramePageEmbed(origin, imageUrl, buttonTitle))
  if (html.includes('</head>')) {
    return html.replace('</head>', `    ${tags}\n  </head>`)
  }
  return `${tags}\n${html}`
}
