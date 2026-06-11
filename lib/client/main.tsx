import { createRoot } from 'react-dom/client'
import { App } from './App.js'

const mount = document.getElementById('sf-root')
if (mount) {
  createRoot(mount).render(<App />)
}
