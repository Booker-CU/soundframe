import { ImageResponse } from '@vercel/og'
import { theme } from './styles/theme.js'

/** 3:2 PNG for fc:miniapp `imageUrl` on /frame (spec: min 600×400, max 1024-char URL). */
export function embedCardImageResponse() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: `radial-gradient(circle at 28% 22%, rgba(255, 85, 0, 0.42), transparent 52%), linear-gradient(155deg, #2a1810 0%, ${theme.background} 48%, #1a1a1a 100%)`,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          justifyContent: 'center',
          textAlign: 'center',
          width: '100%',
        }}
      >
        <div
          style={{
            color: theme.primary,
            display: 'flex',
            fontSize: 42,
            fontWeight: 800,
            letterSpacing: '0.08em',
            lineHeight: 1.1,
          }}
        >
          SOUND FRAME
        </div>
        <div
          style={{
            color: '#ffffff',
            display: 'flex',
            fontSize: 72,
            fontWeight: 800,
            letterSpacing: '-0.025em',
            lineHeight: 1.15,
            marginTop: 24,
            maxWidth: 900,
            padding: '0 80px',
          }}
        >
          Paste a SoundCloud link
        </div>
        <div
          style={{
            color: '#d4d4d4',
            display: 'flex',
            fontSize: 34,
            fontWeight: 700,
            marginTop: 20,
            maxWidth: 820,
            padding: '0 80px',
          }}
        >
          Tap Load Track to open the player
        </div>
        <div
          style={{
            background: theme.primary,
            borderRadius: 999,
            display: 'flex',
            height: 14,
            marginTop: 36,
            width: 280,
          }}
        />
      </div>
    ),
    {
      width: 1200,
      height: 800,
      headers: {
        'Cache-Control': 'public, max-age=3600, must-revalidate',
      },
    }
  )
}
