import * as esbuild from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

import { buildFarcasterManifest } from '../lib/manifest.js'

function deploymentOrigin() {
  const fromEnv =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    process.env.VERCEL_BRANCH_URL
  if (fromEnv) return `https://${fromEnv.replace(/^https?:\/\//, '')}`
  return 'http://localhost:5173'
}

const sharedBuild = {
  bundle: true,
  platform: 'browser' as const,
  format: 'esm' as const,
  packages: 'external' as const,
  logLevel: 'info' as const,
}

/**
 * Vercel Edge Functions cannot import modules outside `api/` (e.g. `../lib/*`).
 * Bundle local sources into `api/` routes.
 *
 * Do not run `frog vercel-build`: it writes `.vercel/output/config.json` (Build
 * Output API) with stub `.func` dirs missing `.vc-config.json`, which breaks deploy.
 */
rmSync('.vercel/output', { recursive: true, force: true })
rmSync('api/index.js', { force: true })
rmSync('api/player', { recursive: true, force: true })
mkdirSync('api/player', { recursive: true })

mkdirSync('public/.well-known', { recursive: true })
writeFileSync(
  'public/.well-known/farcaster.json',
  `${JSON.stringify(buildFarcasterManifest(deploymentOrigin()), null, 2)}\n`
)

await Promise.all([
  esbuild.build({
    ...sharedBuild,
    entryPoints: ['server/entry.prod.tsx'],
    outfile: 'api/[[...path]].js',
    jsx: 'automatic',
    jsxImportSource: 'frog/jsx',
  }),
  esbuild.build({
    ...sharedBuild,
    entryPoints: ['server/player.prod.tsx'],
    outfile: 'api/player/[[...path]].js',
  }),
])
