import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { openPathPlugin } from './vite-plugin-open-path'

export default defineConfig({
  plugins: [vue(), tailwindcss(), openPathPlugin()],
  server: {
    port: 5180,
  },
})
