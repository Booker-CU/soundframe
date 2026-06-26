# SoundFrame

**A SoundCloud tool for Farcaster** — paste a link, tap Listen, and hear tracks without leaving the feed.

SoundFrame makes it easier to share and play SoundCloud tracks inside Farcaster: turn any public track URL into a Listen frame with an embedded player. No redirects, no switching apps. Share a link in a cast and your followers can hit play right there.

**Live app:** [soundframe.vercel.app](https://soundframe.vercel.app)

---

## What you need

- A **Farcaster account** and a client that supports Frames v2 mini apps (e.g. Warpcast, or other Farcaster / Neynar-powered apps with frame support)
- A **public SoundCloud track link** (`soundcloud.com/...` — individual tracks only; playlists and profiles are not supported)
- An internet connection

No wallet, API key, or SoundCloud login is required to listen.

---

## How to use SoundFrame

### Option A — Share a cast that already has a SoundCloud link

1. Find a cast in your feed that includes a SoundCloud URL.
2. Tap **Share** (or the cast actions menu).
3. Choose **Open in SoundFrame**.
4. SoundFrame finds the link, builds a Listen frame, and opens your cast composer with the embed ready.
5. Post the cast.
6. Anyone who sees it can tap **▶️ Listen** to open the player.

### Option B — Add SoundFrame while writing a cast

1. Open the **cast composer** (new post).
2. Tap the actions menu and choose **Add SoundFrame**.
3. Paste a SoundCloud track URL and tap **Load Track**.
4. SoundFrame resolves the track and adds the Listen frame embed to your draft.
5. Post when you are ready.

### Option C — Open SoundFrame directly

1. Search for **SoundFrame** in your Farcaster client, or open [soundframe.vercel.app/player](https://soundframe.vercel.app/player).
2. Paste a SoundCloud URL and tap **Load Track**.
3. The player opens with track artwork and the SoundCloud waveform.
4. Tap play. Use **Share** to compose a cast with the track embed.

### Listening from a shared cast

1. Scroll to a cast with a SoundFrame embed.
2. Tap **▶️ Listen**.
3. The player webview opens with artwork and a full scrubbable waveform (great for long DJ mixes).
4. Tap play on the SoundCloud player.

---

## Background listening (a great feature)

Once playback has started, you can **minimize the player** and keep browsing your feed. Music continues as long as the SoundFrame webview stays open — you do not have to keep the player full-screen.

This works because Farcaster keeps the mini app alive in the background (like a picture-in-picture player). Close or dismiss the webview to stop playback.

Perfect for long sets and DJ mixes: the player uses a tall waveform so you can scrub through hours of audio without leaving Farcaster.

---

## What SoundFrame supports

| Works | Does not work |
|-------|----------------|
| Public SoundCloud track URLs | Private or removed tracks |
| `soundcloud.com` and `www.soundcloud.com` links | Playlist or profile URLs |
| Cast actions, composer actions, and direct paste | Tracks that SoundCloud blocks from embedding |

If a link cannot be resolved, SoundFrame shows a clear error and a **Retry** option.

---

## Compatibility

SoundFrame follows the Farcaster Mini App and Frames v2 specs. It works in any client that supports mini apps and frame embeds — not only Warpcast. That includes other Farcaster clients and Neynar-powered apps that implement frame support.

The **Open in SoundFrame** cast action (sharing an existing cast) is most reliable in Warpcast today. Composer actions and the direct player work broadly wherever mini apps are supported.

---

## For developers

Local development:

```bash
npm install
npm run dev
```

Then open [http://localhost:5173/api](http://localhost:5173/api) (Frog dev server).

Build for production:

```bash
npm run build
npm run deploy
```

Stack: [Frog.fm](https://frog.fm) + Hono on Vercel Edge, Farcaster Frames v2 Mini App SDK, SoundCloud oEmbed for track resolution. See [PRD.md](./PRD.md) for architecture and requirements.
