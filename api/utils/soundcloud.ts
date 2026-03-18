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

/**
 * Resolves a user-provided SoundCloud URL into a sanitized SoundCloud `trackId`.
 *
 * Implementation notes:
 * - We call SoundCloud's oEmbed endpoint for tracks.
 * - The oEmbed `html` contains an iframe src which references `api.soundcloud.com/tracks/<trackId>`.
 * - We extract the trackId via regex and validate it with the strict alphanumeric guardrail.
 */
export async function resolveSoundCloudTrackId(inputUrlRaw: string): Promise<string> {
  // Validate early with zod.
  const inputUrlStr = SoundCloudUrlSchema.parse(inputUrlRaw)
  const inputUrl = new URL(inputUrlStr)

  // Guardrail: verify hostname before any fetch.
  assertSoundCloudHostname(inputUrl)

  const oEmbedUrl = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(inputUrlStr)}`
  const res = await fetch(oEmbedUrl, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
  })

  if (!res.ok) {
    throw new Error('SoundCloud oEmbed request failed.')
  }

  const json = (await res.json()) as OEmbedResponse
  const html = typeof json?.html === 'string' ? json.html : ''

  // Extract trackId from oEmbed iframe src.
  // Example: ... api.soundcloud.com/tracks/<TRACK_ID> ...
  const match = html.match(/api\.soundcloud\.com\/tracks\/([A-Za-z0-9]+)/)
  if (!match?.[1]) {
    throw new Error('Could not resolve SoundCloud trackId.')
  }

  // Guardrail: sanitize/validate before usage in HTML/iframe params.
  const trackId = TrackIdSchema.parse(match[1])
  return trackId
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

