import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // GitHub Pages 子路径部署：https://<user>.github.io/webui-set/
  base: '/webui-set/',
  plugins: [react()],
  server: { port: 5280, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
})
