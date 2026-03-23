import { z } from 'zod'

// Security guardrails:
// - Only accept SoundCloud hostnames.
// - Only accept strictly alphanumeric track IDs before using them in iframe URLs.
const SOUND_CLOUD_ALLOWED_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com'])

const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const TrackIdSchema = z.string().regex(TRACK_ID_ALPHANUM_RE, {
  message: 'Invalid trackId. Must be strictly alphanumeric.',
})

const SoundCloudUrlSchema = z
  .string()
  .url({
    message: 'Invalid URL.',
  })

function assertSoundCloudHostname(inputUrl: URL) {
  if (!SOUND_CLOUD_ALLOWED_HOSTS.has(inputUrl.hostname)) {
    throw new Error('Invalid SoundCloud hostname.')
  }
}

type OEmbedResponse = {
  html?: string
  [key: string]: unknown
}

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
    assertSoundCloudHostname(inputUrl)

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
  const trackId = await resolveSoundCloudTrackIdViaOEmbed(inputUrlRaw)

  if (!trackId) {
    return { ok: false, error: 'unresolvable' }
  }

  return { ok: true, trackId }
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

