import { z } from 'zod'

// Security guardrails:
// - Canonical URLs must use soundcloud.com / www.soundcloud.com before oEmbed processing.
// - Mobile share short links (on.soundcloud.com) are resolved to canonical URLs first.
// - Only accept strictly alphanumeric track IDs before using them in iframe URLs.
const SOUND_CLOUD_CANONICAL_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])
const SOUND_CLOUD_SHORT_LINK_HOSTS = new Set(['on.soundcloud.com'])

const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const TrackIdSchema = z.string().regex(TRACK_ID_ALPHANUM_RE, {
  message: 'Invalid trackId. Must be strictly alphanumeric.',
})

const SoundCloudUrlSchema = z
  .string()
  .url({
    message: 'Invalid URL.',
  })

function extractTrackIdFromApiUrl(inputUrlRaw: string): string | null {
  try {
    const inputUrl = new URL(inputUrlRaw)
    if (inputUrl.hostname !== 'api.soundcloud.com') return null
    const match = inputUrl.pathname.match(/^\/tracks\/([A-Za-z0-9]+)/)
    if (!match?.[1]) return null
    return TrackIdSchema.parse(match[1])
  } catch {
    return null
  }
}

function isSoundCloudHostname(hostname: string): boolean {
  return (
    SOUND_CLOUD_CANONICAL_HOSTS.has(hostname) ||
    SOUND_CLOUD_SHORT_LINK_HOSTS.has(hostname) ||
    hostname === 'api.soundcloud.com' ||
    hostname.endsWith('.soundcloud.com')
  )
}

function trimTrailingUrlPunctuation(url: string): string {
  return url.replace(/[)\]},.!?;:]+$/, '')
}

/**
 * Pulls a SoundCloud URL from free-form share text (mobile shares prepend conversational copy).
 * Prefers soundcloud.com links when multiple http(s) URLs are present.
 */
export function extractSoundCloudUrlFromText(text: string): string | null {
  const normalized = text.replace(/\u200b/g, '').trim()
  const scMatches = normalized.match(/https?:\/\/(?:[\w-]+\.)*soundcloud\.com\/[^\s<>"']+/gi)
  if (scMatches?.length) {
    return trimTrailingUrlPunctuation(scMatches[scMatches.length - 1])
  }
  return null
}

/** Scan cast body text and embed URLs for the first SoundCloud link. */
export function extractSoundCloudUrlFromCastContent(
  text: string,
  embeds: string[] = []
): string | null {
  const fromText = extractSoundCloudUrlFromText(text)
  if (fromText) return fromText

  for (const embed of embeds) {
    const fromEmbed = extractSoundCloudUrlFromText(embed)
    if (fromEmbed) return fromEmbed
  }

  return null
}

/**
 * Returns a canonical soundcloud.com track URL, following mobile share short links when needed.
 */
export async function normalizeSoundCloudInputUrl(inputUrlRaw: string): Promise<string | null> {
  let inputUrlStr: string
  try {
    inputUrlStr = SoundCloudUrlSchema.parse(inputUrlRaw)
  } catch {
    return null
  }

  const inputUrl = new URL(inputUrlStr)
  if (SOUND_CLOUD_CANONICAL_HOSTS.has(inputUrl.hostname)) {
    return `${inputUrl.origin}${inputUrl.pathname}`
  }

  if (!SOUND_CLOUD_SHORT_LINK_HOSTS.has(inputUrl.hostname)) {
    return null
  }

  try {
    const res = await fetch(inputUrlStr, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'text/html',
        'user-agent': 'SoundFrame/1.0 (compatible; Farcaster Mini App)',
      },
    })
    if (!res.ok) return null

    const finalUrl = new URL(res.url)
    if (!SOUND_CLOUD_CANONICAL_HOSTS.has(finalUrl.hostname)) {
      return null
    }

    return `${finalUrl.origin}${finalUrl.pathname}`
  } catch {
    return null
  }
}

type OEmbedResponse = {
  html?: string
  [key: string]: unknown
}

const TRACK_PAGE_CANONICAL_URL_RE = /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
const TRACK_PAGE_OG_IMAGE_RE = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i
const TRACK_PAGE_TWITTER_IMAGE_RE =
  /<meta[^>]+property=["']twitter:image["'][^>]+content=["']([^"']+)["']/i
const TRACK_PAGE_ITEMPROP_IMAGE_RE = /<img[^>]+itemprop=["']image["'][^>]+src=["']([^"']+)["']/i

function isOEmbedDebugEnabled(): boolean {
  // Keep this opt-in so production logs stay quiet.
  return (
    typeof process !== 'undefined' &&
    typeof process.env?.SOUNDFRAME_DEBUG_OEMBED === 'string' &&
    process.env.SOUNDFRAME_DEBUG_OEMBED === '1'
  )
}

function logOEmbedDebug(message: string, data?: Record<string, unknown>) {
  if (!isOEmbedDebugEnabled()) return
  if (data) {
    console.log(`[soundframe:oembed] ${message}`, data)
    return
  }
  console.log(`[soundframe:oembed] ${message}`)
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function parseSoundCloudHttpUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function extractTrackPageImageUrl(html: string): string | undefined {
  const candidates = [
    html.match(TRACK_PAGE_OG_IMAGE_RE)?.[1],
    html.match(TRACK_PAGE_TWITTER_IMAGE_RE)?.[1],
    html.match(TRACK_PAGE_ITEMPROP_IMAGE_RE)?.[1],
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const decoded = decodeHtmlAttribute(candidate)
    const valid = parseSoundCloudHttpUrl(decoded)
    if (valid) return valid
  }

  return undefined
}

async function resolveCanonicalTrackPageUrl(trackId: string): Promise<string | null> {
  const widgetUrl =
    `https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/${trackId}` +
    '&show_artwork=true'

  try {
    const res = await fetch(widgetUrl, {
      method: 'GET',
      headers: {
        accept: 'text/html',
      },
    })
    if (!res.ok) return null

    const html = await res.text()
    const canonical = html.match(TRACK_PAGE_CANONICAL_URL_RE)?.[1]
    if (!canonical) return null

    const normalized = parseSoundCloudHttpUrl(decodeHtmlAttribute(canonical))
    if (!normalized) return null

    const canonicalUrl = new URL(normalized)
    if (!SOUND_CLOUD_CANONICAL_HOSTS.has(canonicalUrl.hostname)) {
      return null
    }

    return canonicalUrl.toString()
  } catch {
    return null
  }
}

async function fetchTrackPageImageUrl(trackPageUrl: string): Promise<string | undefined> {
  try {
    const parsed = new URL(trackPageUrl)
    if (!SOUND_CLOUD_CANONICAL_HOSTS.has(parsed.hostname)) return undefined

    const res = await fetch(trackPageUrl, {
      method: 'GET',
      headers: {
        accept: 'text/html',
      },
    })
    if (!res.ok) return undefined

    const html = await res.text()
    return extractTrackPageImageUrl(html)
  } catch {
    return undefined
  }
}

export type ParseSoundCloudUrlResult =
  | { ok: true; trackId: string }
  | { ok: false; error: 'unresolvable' }

/**
 * Resolves a user-provided SoundCloud URL into a sanitized SoundCloud `trackId`
 * using SoundCloud's oEmbed JSON + a regex extraction from the returned `html`.
 */
async function resolveSoundCloudTrackIdViaOEmbed(inputUrlRaw: string): Promise<string | null> {
  try {
    // Validate early with zod.
    const inputUrlStr = SoundCloudUrlSchema.parse(inputUrlRaw)
    const inputUrl = new URL(inputUrlStr)

    // Guardrail: verify hostname before any fetch.
    if (!isSoundCloudHostname(inputUrl.hostname)) {
      throw new Error('Invalid SoundCloud hostname.')
    }

    const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(inputUrlStr)}&format=json`
    const res = await fetch(oEmbedUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
    })

    if (!res.ok) {
      logOEmbedDebug('oEmbed request failed', {
        status: res.status,
        statusText: res.statusText,
        url: oEmbedUrl,
      })
      return null
    }

    // SoundCloud may occasionally return non-JSON error text with 200 status.
    // Parse defensively to avoid throwing during frame rendering.
    const text = await res.text()
    if (!text.trim()) return null

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      logOEmbedDebug('oEmbed returned non-JSON body', {
        status: res.status,
        bodyPreview: text.slice(0, 120),
      })
      return null
    }

    const oEmbed = json as OEmbedResponse
    const html = typeof oEmbed.html === 'string' ? oEmbed.html : ''

  // Extract the numeric track id from the oEmbed iframe `src`.
  // SoundCloud sometimes percent-encodes portions of the `url=` parameter.
  const match =
    html.match(/api\.soundcloud\.com\/tracks(?:%2F|\/)([0-9]+)/) ??
    html.match(/api\.soundcloud\.com%2Ftracks(?:%2F|\/)([0-9]+)/) ??
    html.match(/api\.soundcloud\.com%2Ftracks%2F([0-9]+)/)

    if (!match?.[1]) return null

    // Guardrail: sanitize/validate before usage in HTML/iframe params.
    try {
      return TrackIdSchema.parse(match[1])
    } catch {
      return null
    }
  } catch {
    return null
  }
}

/**
 * Test/PRD-facing API: parse a user-provided SoundCloud URL into a sanitized track id.
 *
 * Returns:
 * - `{ ok: true, trackId }` on success (trackId is validated as strictly alphanumeric).
 * - `{ ok: false, error: 'unresolvable' }` when the track cannot be resolved (invalid/private/etc).
 */
export async function parseSoundCloudUrl(inputUrlRaw: string): Promise<ParseSoundCloudUrlResult> {
  const apiTrackId = extractTrackIdFromApiUrl(inputUrlRaw)
  if (apiTrackId) {
    return { ok: true, trackId: apiTrackId }
  }

  const canonicalUrl = await normalizeSoundCloudInputUrl(inputUrlRaw)
  if (canonicalUrl) {
    const trackId = await resolveSoundCloudTrackIdViaOEmbed(canonicalUrl)
    if (trackId) {
      return { ok: true, trackId }
    }
  }

  try {
    const host = new URL(inputUrlRaw).hostname
    if (isSoundCloudHostname(host)) {
      const trackId = await resolveSoundCloudTrackIdViaOEmbed(inputUrlRaw)
      if (trackId) {
        return { ok: true, trackId }
      }
    }
  } catch {
    // Fall through to unresolvable.
  }

  return { ok: false, error: 'unresolvable' }
}

function normalizeColorHex(colorHexRaw: string): string {
  const color = colorHexRaw.trim()
  const normalized = color.startsWith('#') ? color : `#${color}`
  const match = /^#([0-9a-fA-F]{6})$/.exec(normalized)
  if (!match) throw new Error('Invalid color hex.')
  return `#${match[1].toLowerCase()}`
}

/**
 * Builds a SoundCloud widget iframe URL for the Farcaster player webview.
 *
 * Security guardrails:
 * - `trackId` is validated with strict alphanumeric regex before insertion.
 * - No user-provided HTML is injected (we only generate URL strings).
 */
export function buildSoundCloudPlayerIframeUrl(params: {
  trackId: string
  colorHex: string
}) {
  const trackId = TrackIdSchema.parse(params.trackId)
  const colorHex = normalizeColorHex(params.colorHex)

  // PRD specifies the color query param as `%23ff5500` (encoded `#ff5500`).
  const colorParam = `%23${colorHex.slice(1)}`

  // PRD example encodes only the scheme portion (`https%3A//...`).
  const apiTrackUrlParam = `https%3A//api.soundcloud.com/tracks/${trackId}`

  return `https://w.soundcloud.com/player/?url=${apiTrackUrlParam}&color=${colorParam}`
}

/** SoundCloud oEmbed sometimes returns a generic social placeholder instead of track art. */
export function isSoundCloudPlaceholderArtwork(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.hostname !== 'soundcloud.com' && parsed.hostname !== 'www.soundcloud.com') {
      return false
    }
    return /fb_placeholder|placeholder/i.test(parsed.pathname)
  } catch {
    return false
  }
}

function normalizeTrackArtworkUrl(url: string | undefined): string | undefined {
  if (!url || isSoundCloudPlaceholderArtwork(url)) return undefined
  return url
}

/** Smaller CDN variant for frame OG rasterization (avoids huge artwork flash). */
export function frameArtworkUrlFromOEmbed(thumbnailUrl: string): string {
  return thumbnailUrl
    .replace(/-t\d+x\d+/gi, '-t200x200')
    .replace(/-(?:large|original)(?=\.(?:jpg|jpeg|png|webp))/i, '-t200x200')
}

/** Resolve artwork from a canonical soundcloud.com track URL (og:image / twitter:image). */
export async function fetchTrackArtworkFromPageUrl(
  trackPageUrl: string
): Promise<string | undefined> {
  const canonical = await normalizeSoundCloudInputUrl(trackPageUrl)
  if (!canonical) return undefined
  return normalizeTrackArtworkUrl(await fetchTrackPageImageUrl(canonical))
}

const OEmbedThumbnailSchema = z.object({
  thumbnail_url: z.string().url().optional(),
})

/**
 * Resolve track artwork via SoundCloud oEmbed when the player URL has no `?artwork=`.
 */
export async function fetchTrackThumbnailUrl(trackId: string): Promise<string | undefined> {
  try {
    const id = TrackIdSchema.parse(trackId)
    const canonicalTrackPageUrl = await resolveCanonicalTrackPageUrl(id)
    if (canonicalTrackPageUrl) {
      const trackPageImage = normalizeTrackArtworkUrl(
        await fetchTrackPageImageUrl(canonicalTrackPageUrl)
      )
      if (trackPageImage) return trackPageImage
    }

    const trackApiUrl = `https://api.soundcloud.com/tracks/${id}`
    const oEmbedUrl = `https://soundcloud.com/oembed?url=${encodeURIComponent(trackApiUrl)}&format=json`
    const res = await fetch(oEmbedUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return undefined

    const text = await res.text()
    if (!text.trim()) return undefined

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return undefined
    }

    const parsed = OEmbedThumbnailSchema.safeParse(json)
    return normalizeTrackArtworkUrl(parsed.success ? parsed.data.thumbnail_url : undefined)
  } catch {
    return undefined
  }
}


