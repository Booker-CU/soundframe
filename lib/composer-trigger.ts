import { z } from 'zod'
import { resolveCastToFrameUrl } from './cast-trigger.js'
import {
  frameUrlErrorMessage,
  miniAppShellHtml,
  playerLandingBody,
} from './player-pages.js'

export const COMPOSER_TRIGGER_ID = 'soundframe-from-composer'
export const COMPOSER_TRIGGER_NAME = 'Add SoundFrame'

const ComposerResolveBodySchema = z.object({
  url: z.string().min(1).max(2048),
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

function composerFormUrl(origin: string): string {
  return `${origin.replace(/\/$/, '')}/triggers/composer/form`
}

/** Legacy Warpcast composer-action catalog metadata (GET /triggers/composer). */
export function composerActionMetadataResponse(origin: string) {
  const base = origin.replace(/\/$/, '')
  return jsonResponse({
    type: 'composer',
    name: COMPOSER_TRIGGER_NAME,
    icon: 'music',
    description: 'Paste a SoundCloud link to add a Listen frame to your cast.',
    aboutUrl: `${base}/player`,
    imageUrl: `${base}/icon.png`,
    action: {
      type: 'post',
    },
  })
}

/** Legacy Warpcast composer-action invoke response (POST /triggers/composer). */
export function composerActionFormResponse(origin: string) {
  return jsonResponse({
    type: 'form',
    title: 'SoundFrame',
    url: composerFormUrl(origin),
  })
}

export async function handleComposerTriggerRequest(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  const origin = new URL(request.url).origin

  if (request.method === 'GET') {
    return composerActionMetadataResponse(origin)
  }

  if (request.method === 'POST') {
    return composerActionFormResponse(origin)
  }

  return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
}

export async function handleComposerTriggerResolveRequest(request: Request): Promise<Response> {
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

  const parsedBody = ComposerResolveBodySchema.safeParse(body)
  if (!parsedBody.success) {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400)
  }

  const origin = new URL(request.url).origin
  const result = await resolveCastToFrameUrl(origin, parsedBody.data.url.trim(), [])

  if (!result.ok) {
    return jsonResponse(result)
  }

  return jsonResponse(result)
}

export function composerTriggerFormPageResponse(origin: string) {
  const resolveUrl = JSON.stringify(`${origin}/triggers/composer/resolve`)
  const errorMessages = JSON.stringify({
    invalid: frameUrlErrorMessage('invalid'),
    not_found: frameUrlErrorMessage('not_found'),
  })

  return new Response(
    miniAppShellHtml(
      `${playerLandingBody(undefined, undefined, { formId: 'paste-form' })}
      <p id="status" style="margin-top:16px;color:#d4d4d4;" aria-live="polite"></p>`,
      `<style>
        button[type='submit']:disabled {
          opacity: 0.6;
          cursor: wait;
        }
      </style>`
    ).replace(
      '</body>',
      `    <script type="module">
      import { sdk } from 'https://esm.sh/@farcaster/miniapp-sdk'

      const RESOLVE_URL = ${resolveUrl}
      const ERROR_MESSAGES = ${errorMessages}
      const form = document.getElementById('paste-form')
      const status = document.getElementById('status')
      const submitButton = form?.querySelector('button[type="submit"]')

      window.sdk = sdk

      function showFormError(message) {
        let errorEl = document.querySelector('main .error')
        if (!errorEl) {
          errorEl = document.createElement('p')
          errorEl.className = 'error'
          errorEl.setAttribute('role', 'alert')
          form?.insertAdjacentElement('beforebegin', errorEl)
        }
        errorEl.textContent = message
      }

      function clearFormError() {
        const errorEl = document.querySelector('main .error')
        errorEl?.remove()
      }

      function normalizeComposerEmbeds(embeds) {
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

      async function readComposerDraft() {
        const context = await Promise.resolve(sdk.context)
        const location = context?.location
        if (location?.type !== 'composer' || !location.cast) {
          return { text: '', embeds: [] }
        }
        return {
          text: typeof location.cast.text === 'string' ? location.cast.text : '',
          embeds: normalizeComposerEmbeds(location.cast.embeds),
        }
      }

      async function resolveFrameUrl(rawUrl) {
        const response = await fetch(RESOLVE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: rawUrl }),
        })
        if (!response.ok) {
          throw new Error('resolve_failed_' + response.status)
        }
        return response.json()
      }

      async function handleSubmit(event) {
        event.preventDefault()
        clearFormError()
        status.textContent = ''

        const input = form?.querySelector('input[name="url"]')
        const rawUrl = typeof input?.value === 'string' ? input.value.trim() : ''
        if (!rawUrl) return

        if (submitButton) submitButton.disabled = true
        status.textContent = 'Resolving track…'

        try {
          const result = await resolveFrameUrl(rawUrl)
          if (!result?.ok || typeof result.frameUrl !== 'string') {
            const code = result?.error === 'not_found' ? 'not_found' : 'invalid'
            showFormError(ERROR_MESSAGES[code])
            status.textContent = ''
            return
          }

          if (!sdk.actions?.composeCast) {
            showFormError('This client does not support composing casts from SoundFrame.')
            status.textContent = ''
            return
          }

          status.textContent = 'Adding SoundFrame to your cast…'
          const draft = await readComposerDraft()
          const embeds = [...draft.embeds, result.frameUrl]

          const composeResult = await sdk.actions.composeCast({
            text: draft.text || undefined,
            embeds,
            close: true,
          })

          if (!composeResult?.cast) {
            status.textContent = 'Cancelled. No cast was updated.'
          } else {
            status.textContent = 'SoundFrame added to your cast.'
          }
        } catch (err) {
          console.error('[SoundFrame] composer trigger failed:', err)
          showFormError('Something went wrong while creating your SoundFrame. Please try again.')
          status.textContent = ''
        } finally {
          if (submitButton) submitButton.disabled = false
        }
      }

      try {
        await sdk.actions.ready()
      } catch (err) {
        console.error('[SoundFrame] ready() failed:', err)
      }

      form?.addEventListener('submit', (event) => {
        void handleSubmit(event)
      })
    </script>
  </body>`
    ),
    {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  )
}

const COMPOSER_TRIGGER_PATH = '/triggers/composer'
const COMPOSER_TRIGGER_FORM_PATH = '/triggers/composer/form'
const COMPOSER_TRIGGER_RESOLVE_PATH = '/triggers/composer/resolve'
const API_COMPOSER_TRIGGER_PATH = '/api/triggers/composer'
const API_COMPOSER_TRIGGER_FORM_PATH = '/api/triggers/composer/form'
const API_COMPOSER_TRIGGER_RESOLVE_PATH = '/api/triggers/composer/resolve'

export function isComposerTriggerResolveRequest(pathname: string): boolean {
  return (
    pathname === COMPOSER_TRIGGER_RESOLVE_PATH ||
    pathname === API_COMPOSER_TRIGGER_RESOLVE_PATH
  )
}

export function isComposerTriggerFormRequest(pathname: string): boolean {
  return (
    pathname === COMPOSER_TRIGGER_FORM_PATH || pathname === API_COMPOSER_TRIGGER_FORM_PATH
  )
}

export function isComposerTriggerActionRequest(pathname: string): boolean {
  return pathname === COMPOSER_TRIGGER_PATH || pathname === API_COMPOSER_TRIGGER_PATH
}
