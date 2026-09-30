import react from '@vitejs/plugin-react'
import { alphaTab } from '@coderline/alphatab-vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), alphaTab()],
})
