import { z } from 'zod'
import {
  extractSoundCloudUrlFromCastContent,
  normalizeSoundCloudInputUrl,
  parseSoundCloudUrl,
} from './utils/soundcloud.js'
import { theme } from './styles/theme.js'

export const CAST_TRIGGER_ID = 'soundframe-from-cast'
export const CAST_TRIGGER_NAME = 'Open in SoundFrame'

export function castShareUrl(origin: string): string {
  const base = origin.replace(/\/$/, '')
  return `${base}/triggers/cast`
}

const TRACK_ID_ALPHANUM_RE = /^[A-Za-z0-9]+$/

const CastResolveBodySchema = z.object({
  text: z.string().max(32_000).default(''),
  embeds: z.array(z.string().max(2048)).max(10).default([]),
})

export type CastResolveResult =
  | { ok: true; frameUrl: string }
  | { ok: false; error: 'invalid' | 'not_found' }

export async function resolveCastToFrameUrl(
  origin: string,
  text: string,
  embeds: string[] = []
): Promise<CastResolveResult> {
  const extracted = extractSoundCloudUrlFromCastContent(text, embeds)
  if (!extracted) {
    return { ok: false, error: 'invalid' }
  }

  const canonical = await normalizeSoundCloudInputUrl(extracted)

  let parsed: Awaited<ReturnType<typeof parseSoundCloudUrl>>
  try {
    parsed = await parseSoundCloudUrl(extracted)
  } catch {
    return { ok: false, error: 'not_found' }
  }

  if (!parsed.ok || !TRACK_ID_ALPHANUM_RE.test(parsed.trackId)) {
    return { ok: false, error: 'not_found' }
  }

  if (canonical) {
    const frameUrl = new URL('/frame', origin)
    frameUrl.searchParams.set('url', canonical)
    return { ok: true, frameUrl: frameUrl.toString() }
  }

  return { ok: true, frameUrl: `${origin.replace(/\/$/, '')}/player/${parsed.trackId}` }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export async function handleCastTriggerResolveRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400)
  }

  const parsedBody = CastResolveBodySchema.safeParse(body)
  if (!parsedBody.success) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400)
  }

  const origin = new URL(request.url).origin
  const result = await resolveCastToFrameUrl(
    origin,
    parsedBody.data.text,
    parsedBody.data.embeds
  )

  if (!result.ok) {
    return jsonResponse(result)
  }

  return jsonResponse(result)
}

function castTriggerErrorMessage(error: 'invalid' | 'not_found'): string {
  if (error === 'invalid') {
    return 'No SoundCloud link was found in this cast.'
  }
  return 'The SoundCloud link in this cast could not be resolved. It may be private, removed, or a mobile link SoundCloud blocked.'
}

export function castTriggerPageResponse(origin: string) {
  const resolveUrl = JSON.stringify(`${origin}/triggers/cast/resolve`)

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"
    />
    <title>SoundFrame</title>
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
        font-size: 1.35rem;
      }
      p {
        margin: 0;
        line-height: 1.5;
        color: #c8c8c8;
      }
      .status {
        margin-top: 16px;
        color: #d4d4d4;
      }
      .error {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid rgba(255, 85, 0, 0.45);
        background: rgba(255, 85, 0, 0.12);
        color: #ffb38a;
        text-align: left;
      }
      button {
        margin-top: 16px;
        width: 100%;
        border: 0;
        border-radius: 10px;
        padding: 12px 14px;
        background: ${theme.primary};
        color: #fff;
        font-weight: 700;
        font-size: 16px;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: wait;
      }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <main>
      <h1>SoundFrame</h1>
      <p id="intro">Looking for a SoundCloud link in this cast…</p>
      <p id="status" class="status" aria-live="polite"></p>
      <p id="error" class="error hidden" role="alert"></p>
      <button id="retry" class="hidden" type="button">Try again</button>
    </main>
    <script type="module">
      import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'

      const RESOLVE_URL = ${resolveUrl}
      const intro = document.getElementById('intro')
      const status = document.getElementById('status')
      const error = document.getElementById('error')
      const retry = document.getElementById('retry')

      window.sdk = sdk

      function showError(message) {
        intro.textContent = 'Could not create a SoundFrame'
        status.textContent = ''
        error.textContent = message
        error.classList.remove('hidden')
        retry.classList.remove('hidden')
      }

      function readCastContext(sdkRef) {
        const location = sdkRef?.context?.location
        if (!location) return null

        if (
          (location.type === 'cast' || location.type === 'cast_share') &&
          location.cast
        ) {
          return {
            text: typeof location.cast.text === 'string' ? location.cast.text : '',
            embeds: normalizeCastEmbeds(location.cast.embeds),
          }
        }

        return null
      }

      function normalizeCastEmbeds(embeds) {
        if (!Array.isArray(embeds)) return []
        const urls = []
        for (const item of embeds) {
          if (typeof item === 'string') urls.push(item)
          else if (item && typeof item === 'object' && typeof item.url === 'string') {
            urls.push(item.url)
          }
        }
        return urls
      }

      function castContentReady(castContent) {
        if (!castContent) return false
        return [castContent.text, ...castContent.embeds].join(' ').trim().length > 0
      }

      async function waitForCastContext(sdkRef, attempts = 50) {
        for (let i = 0; i < attempts; i += 1) {
          const castContent = readCastContext(sdkRef)
          if (castContentReady(castContent)) return castContent
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        return readCastContext(sdkRef)
      }

      async function resolveCastFrame(castContent) {
        const response = await fetch(RESOLVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(castContent),
        })
        if (!response.ok) {
          throw new Error('resolve_failed_' + response.status)
        }
        return response.json()
      }

      async function run() {
        retry.disabled = true
        error.classList.add('hidden')
        retry.classList.add('hidden')
        status.textContent = 'Checking this cast for SoundCloud links…'

        try {
          await sdk.actions.ready()
        } catch (err) {
          console.error('[SoundFrame] ready() failed:', err)
        }

        const castContent = await waitForCastContext(sdk)
        if (!castContentReady(castContent)) {
          showError('Could not read the shared cast yet. Wait a moment, then tap Try again.')
          retry.disabled = false
          return
        }

        try {
          const result = await resolveCastFrame(castContent)
          if (!result?.ok || typeof result.frameUrl !== 'string') {
            const messages = {
              invalid: ${JSON.stringify(castTriggerErrorMessage('invalid'))},
              not_found: ${JSON.stringify(castTriggerErrorMessage('not_found'))},
            }
            const code = result?.error === 'not_found' ? 'not_found' : 'invalid'
            showError(messages[code])
            retry.disabled = false
            return
          }

          status.textContent = 'Opening composer with your SoundFrame…'
          if (!sdk.actions?.composeCast) {
            showError('This client does not support composing casts from SoundFrame.')
            retry.disabled = false
            return
          }

          const composeResult = await sdk.actions.composeCast({
            embeds: [result.frameUrl],
            close: true,
          })

          if (!composeResult?.cast) {
            intro.textContent = 'Cancelled'
            status.textContent = 'No cast was created.'
            error.classList.add('hidden')
            retry.classList.add('hidden')
          } else {
            intro.textContent = 'SoundFrame ready'
            status.textContent = 'Your cast composer was opened with the Listen frame.'
            error.classList.add('hidden')
            retry.classList.add('hidden')
          }
        } catch (err) {
          console.error('[SoundFrame] cast trigger failed:', err)
          showError('Something went wrong while creating your SoundFrame. Please try again.')
          retry.disabled = false
        }
      }

      retry.addEventListener('click', () => {
        void run()
      })

      void run()
    </script>
  </body>
</html>`,
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  )
}

const CAST_TRIGGER_PATH = '/triggers/cast'
const CAST_TRIGGER_RESOLVE_PATH = '/triggers/cast/resolve'
const API_CAST_TRIGGER_PATH = '/api/triggers/cast'
const API_CAST_TRIGGER_RESOLVE_PATH = '/api/triggers/cast/resolve'

export function isCastTriggerResolveRequest(pathname: string): boolean {
  return pathname === CAST_TRIGGER_RESOLVE_PATH || pathname === API_CAST_TRIGGER_RESOLVE_PATH
}

export function isCastTriggerPageRequest(pathname: string): boolean {
  return pathname === CAST_TRIGGER_PATH || pathname === API_CAST_TRIGGER_PATH
}
