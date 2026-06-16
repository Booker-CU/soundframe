import * as esbuild from 'esbuild'
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

import { buildFarcasterManifest } from '../lib/manifest.js'

function deploymentOrigin() {
  const fromEnv =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    process.env.VERCEL_BRANCH_URL
  if (fromEnv) return `https://${fromEnv.replace(/^https?:\/\//, '')}`
  return 'http://localhost:5173'
}

function buildMiniAppEmbed(origin: string) {
  return {
    version: '1',
    imageUrl: `${origin}/splash.png`,
    button: {
      title: 'Open SoundFrame',
      action: {
        type: 'launch_miniapp',
        name: 'SoundFrame',
        url: `${origin}/player`,
        splashImageUrl: `${origin}/splash.png`,
        splashBackgroundColor: '#121212',
      },
    },
  }
}

/**
 * Vercel Edge Functions cannot import modules outside `api/` (e.g. `../lib/*`).
 * Bundle Frog frame routes into `api/[[...path]].js`.
 * `/player` is served as static `public/player.html` (see vercel.json rewrites).
 *
 * Do not run `frog vercel-build`: it writes `.vercel/output/config.json` (Build
 * Output API) with stub `.func` dirs missing `.vc-config.json`, which breaks deploy.
 */
rmSync('.vercel/output', { recursive: true, force: true })
rmSync('api/[[...path]].js', { force: true })
rmSync('api/player', { recursive: true, force: true })

const origin = deploymentOrigin()
const embedJson = JSON.stringify(buildMiniAppEmbed(origin))

mkdirSync('public/.well-known', { recursive: true })
writeFileSync(
  'public/.well-known/farcaster.json',
  `${JSON.stringify(buildFarcasterManifest(origin), null, 2)}\n`
)

copyFileSync(
  'node_modules/@farcaster/miniapp-sdk/dist/index.min.js',
  'public/miniapp-sdk.js'
)

const playerHtml = readFileSync('lib/player.template.html', 'utf8').replaceAll(
  '__FC_MINIAPP_EMBED__',
  embedJson.replace(/'/g, '&#39;')
)
writeFileSync('public/player.html', playerHtml)

await esbuild.build({
  entryPoints: ['server/entry.prod.tsx'],
  outfile: 'api/index.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  jsxImportSource: 'frog/jsx',
  logLevel: 'info',
})
