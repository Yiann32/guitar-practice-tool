import react from '@vitejs/plugin-react'
import { alphaTab } from '@coderline/alphatab-vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), alphaTab()],
})
