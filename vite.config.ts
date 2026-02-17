import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { openPathPlugin } from './vite-plugin-open-path'
import fs from 'node:fs'
import path from 'node:path'

// Plugin to serve local media files (for agent-sent images)
function localMediaPlugin() {
  return {
    name: 'local-media',
    configureServer(server: any) {
      server.middlewares.use('/api/media', (req: any, res: any) => {
        const url = new URL(req.url, 'http://localhost')
        const filePath = url.searchParams.get('path')
        if (!filePath || !filePath.startsWith('/')) {
          res.statusCode = 400
          res.end('Bad path')
          return
        }
        // Security: only allow paths under ~/.openclaw/media/
        const home = process.env.HOME || ''
        const allowed = [
          path.join(home, '.openclaw/media'),
          path.join(home, '.openclaw/workspace'),
        ]
        if (!allowed.some(p => filePath.startsWith(p))) {
          res.statusCode = 403
          res.end('Forbidden')
          return
        }
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        const mimeMap: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
        }
        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
        fs.createReadStream(filePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), tailwindcss(), openPathPlugin(), localMediaPlugin()],
  server: {
    port: 5180,
  },
})
