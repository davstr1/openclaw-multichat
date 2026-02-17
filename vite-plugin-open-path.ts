import type { Plugin } from 'vite'
import { exec } from 'child_process'

export function openPathPlugin(): Plugin {
  return {
    name: 'open-path',
    configureServer(server) {
      server.middlewares.use('/api/open-path', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }

        let body = ''
        req.on('data', (chunk: Buffer) => { body += chunk.toString() })
        req.on('end', () => {
          try {
            const { path } = JSON.parse(body)
            if (!path || typeof path !== 'string') {
              res.statusCode = 400
              res.end('Missing path')
              return
            }

            // Resolve ~ to home dir
            const resolved = path.replace(/^~/, process.env.HOME || '')

            console.log('[open-path] Opening:', resolved)
            // macOS: use `open` command
            exec(`open "${resolved}"`, (err) => {
              if (err) {
                console.error('[open-path] Error:', err.message)
                res.statusCode = 500
                res.end(JSON.stringify({ error: err.message }))
              } else {
                res.statusCode = 200
                res.end(JSON.stringify({ ok: true }))
              }
            })
          } catch {
            res.statusCode = 400
            res.end('Invalid JSON')
          }
        })
      })
    },
  }
}
