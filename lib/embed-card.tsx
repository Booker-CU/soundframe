import { ImageResponse } from '@vercel/og'
import { theme } from './styles/theme.js'

/** 3:2 PNG for fc:miniapp `imageUrl` on /frame (spec: min 600×400, max 1024-char URL). */
export function embedCardImageResponse() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: theme.background,
          display: 'flex',
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        <div
          style={{
            background: `radial-gradient(circle at 30% 25%, ${theme.primary}, #2a1810 55%, ${theme.background} 100%)`,
            borderRadius: 32,
            height: 280,
            width: 280,
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 800,
      headers: {
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    }
  )
}
