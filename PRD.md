PRD: SoundFrame — The Universal SoundCloud Utility (v2)
1. Product Mission

To provide a seamless, high-fidelity music sharing experience within the Farcaster ecosystem. SoundFrame converts raw SoundCloud URLs into interactive Frames with an embedded player, eliminating external redirects.
2. Technical Stack (2026 Standards)

    Engine: Hono (Vercel Edge Runtime)

    Framework: Frog.fm + Farcaster Frames v2 (Mini App)

    Identity/Signer: Neynar (Managed App Wallet)

    Validation: zod (for schema and URL safety)

    SDK: Farcaster Frames v2 SDK (@farcaster/frame-sdk)

3. Visual Identity & Branding

    Primary Color: #FF5500 (SoundCloud International Orange)

    Secondary Color: #000000 (True Black)

    Backgrounds: Dark-mode focused (#121212) for the player webview.

    UI Assets: All buttons and progress bars must use the primary orange hex.

4. Folder & Route Map (Vercel-Native)

    Root: api/index.tsx (Main entry point for Frog/Hono)

    Utilities: api/utils/soundcloud.ts (Logic for link parsing)

    Styles: api/styles/theme.ts (Branding constants)

    Static Assets: public/ (For logos/images)

    Manifest: /.well-known/farcaster.json (App association)

5. Core Feature Requirements
A. The SoundCloud Parser (api/utils/soundcloud.ts)

    Host Validation: Must verify the hostname is soundcloud.com or www.soundcloud.com.

    Extraction: Use the SoundCloud OEmbed API to resolve track IDs; do not scrape HTML.

    Security: Sanitize all track IDs via alphanumeric regex before injection.

B. The Feed Frame (/api/frame)

    Design: 3:2 Aspect Ratio. Show track artwork with an #FF5500 play button overlay.

    Action: Clicking the button triggers the v2 Webview player.

C. The Player Mini App Webview (/player/:trackId)

    Logic: A Farcaster Frames v2 Mini App HTML/TSX page serving the SoundCloud widget.

    Role: Primary media delivery vehicle for playback inside Farcaster.

    Statelessness: Route is stateless; playback state is carried only in URL params (trackId), with no database/session dependency.

    Iframe URL: https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/[trackId]&color=%23ff5500.

    Waveform Height: 166px is mandatory for large, scrubbable DJ mix navigation.

    UX: Mobile-optimized, viewport-fit=cover, non-scalable.

6. Security & QA Standards

    Statelessness: No database usage. All state must be carried in URL parameters.

    Error States: If a link is invalid/private, render a "Track Unavailable" Frame image with a "Retry" button.

    Sanitization: Use zod to validate all incoming request bodies.

7. QA Verification

    Verify `sdk.actions.ready()` is present on page load (prevents v2 timeout errors).

    Confirm the SoundCloud iframe is exactly 166px tall (DJ mix navigation requirement).

    Ensure `auto_play=false` in the iframe URL (mobile compliance).