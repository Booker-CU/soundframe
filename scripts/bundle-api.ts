import * as esbuild from 'esbuild'

/**
 * Vercel Edge Functions cannot import modules outside `api/` (e.g. `../lib/*`).
 * Bundle local sources into a single `api/index.tsx` before `frog vercel-build`.
 */
await esbuild.build({
  entryPoints: ['server/entry.prod.tsx'],
  outfile: 'api/index.tsx',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  packages: 'external',
  jsx: 'automatic',
  jsxImportSource: 'frog/jsx',
  logLevel: 'info',
})
