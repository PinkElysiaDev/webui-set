import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // 旧版挂在主站 /legacy/ 子路径
  base: '/webui-set/legacy/',
  plugins: [react()],
  server: { port: 5280, strictPort: true },
  build: { chunkSizeWarningLimit: 1500 },
})
