import { z } from 'zod'

const CastHashSchema = z.string().regex(/^0x[a-fA-F0-9]+$/)
const CastFidSchema = z.number().int().positive()

export type CastContent = {
  text: string
  embeds: string[]
}

function normalizeWarpcastEmbeds(embeds: unknown): string[] {
  if (!Array.isArray(embeds)) return []

  const urls: string[] = []
  for (const item of embeds) {
    if (typeof item === 'string') {
      urls.push(item)
      continue
    }
    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      if (typeof record.url === 'string') urls.push(record.url)
      else if (typeof record.source === 'string') urls.push(record.source)
    }
  }
  return urls
}

/** Fetch shared cast text/embeds from Warpcast's public read API (no API key). */
export async function fetchCastFromWarpcast(
  castFid: number,
  castHash: string
): Promise<CastContent | null> {
  const fid = CastFidSchema.safeParse(castFid)
  const hash = CastHashSchema.safeParse(castHash)
  if (!fid.success || !hash.success) return null

  const url = new URL('https://client.warpcast.com/v2/casts')
  url.searchParams.set('fid', String(fid.data))
  url.searchParams.set('hashes', hash.data)

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    })
    if (!res.ok) return null

    const json = (await res.json()) as {
      result?: { casts?: Array<{ text?: string; embeds?: unknown }> }
    }
    const cast = json.result?.casts?.[0]
    if (!cast) return null

    return {
      text: typeof cast.text === 'string' ? cast.text : '',
      embeds: normalizeWarpcastEmbeds(cast.embeds),
    }
  } catch {
    return null
  }
}
