import { useEffect } from 'react'
import { sdk } from '@farcaster/frame-sdk'

declare global {
  interface Window {
    sdk?: typeof sdk
  }
}

export function App() {
  useEffect(() => {
    window.sdk = sdk
    void sdk.actions.ready()
  }, [])

  return null
}
