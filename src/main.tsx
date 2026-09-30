import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import '@fontsource-variable/inter'
import '@fontsource/instrument-serif'
import './index.css'
import App from './App.tsx'

if (Capacitor.isNativePlatform()) {
  void StatusBar.setOverlaysWebView({ overlay: false }).catch(() => undefined)
  void StatusBar.setStyle({ style: Style.Light }).catch(() => undefined)
  void StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => undefined)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
