import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { validatePaymentsStaging } from './scripts/validatePaymentsStaging.js'

export default defineConfig(({ mode }) => {
  validatePaymentsStaging({ ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env })
  return { base: '/', plugins: [react()] }
})
