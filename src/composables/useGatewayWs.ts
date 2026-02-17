import { reactive } from 'vue'
import type { ConnectionState } from '../types'
import {
  getOrCreateDeviceIdentity,
  buildDeviceAuthPayload,
  signPayload,
} from './useDeviceAuth'

export interface GatewayWsOptions {
  url: string
  token: string
  onEvent?: (event: string, payload: Record<string, unknown>) => void
  onConnected?: () => void
  onDisconnected?: () => void
}

let reqCounter = 0
function nextId(): string {
  return `r_${++reqCounter}_${Date.now()}`
}

export function useGatewayWs(options: GatewayWsOptions) {
  const connection = reactive<ConnectionState>({ status: 'disconnected' })
  let ws: WebSocket | null = null
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = 1000
  let shouldReconnect = false

  function connect() {
    if (ws) ws.close()
    shouldReconnect = true
    connection.status = 'connecting'
    connection.error = undefined

    ws = new WebSocket(options.url)

    ws.onopen = () => {
      console.log('[WS] socket opened, waiting for challenge...')
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        handleMessage(msg)
      } catch {
        // ignore non-JSON
      }
    }

    ws.onclose = (event) => {
      console.log('[WS] closed:', event.code, event.reason)
      const wasConnected = connection.status === 'connected'
      if (wasConnected) {
        connection.status = 'disconnected'
        options.onDisconnected?.()
      } else {
        connection.status = 'error'
      }
      connection.error = event.reason || `closed (${event.code})`
      flushPending(new Error('disconnected'))
      scheduleReconnect()
    }

    ws.onerror = (event) => {
      console.error('[WS] error:', event)
      connection.status = 'error'
      connection.error = 'WebSocket connection failed'
    }
  }

  function scheduleReconnect() {
    if (!shouldReconnect) return
    if (reconnectTimer) clearTimeout(reconnectTimer)
    console.log(`[WS] reconnecting in ${backoffMs}ms...`)
    reconnectTimer = setTimeout(() => {
      connect()
      backoffMs = Math.min(backoffMs * 1.5, 30000)
    }, backoffMs)
  }

  async function sendConnectReq(nonce?: string) {
    const id = nextId()
    const identity = await getOrCreateDeviceIdentity()
    const signedAtMs = Date.now()
    const role = 'operator'
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']
    const clientId = 'openclaw-control-ui'
    const clientMode = 'webchat'

    const payload = buildDeviceAuthPayload({
      deviceId: identity.deviceId,
      clientId,
      clientMode,
      role,
      scopes,
      signedAtMs,
      token: options.token,
      nonce,
    })

    const signature = await signPayload(identity.privateKey, payload)

    pending.set(id, {
      resolve: (res) => {
        console.log('[WS] connected successfully!')
        connection.status = 'connected'
        backoffMs = 1000
        options.onConnected?.()
        // Store device token if returned
        const r = res as Record<string, unknown>
        if (r?.auth && (r.auth as Record<string, string>).deviceToken) {
          console.log('[WS] got device token')
        }
      },
      reject: (e) => {
        console.error('[WS] connect rejected:', e.message)
        connection.status = 'error'
        connection.error = e.message
      },
    })

    sendRaw({
      type: 'req',
      id,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: clientId,
          version: '0.1.0',
          platform: navigator.platform || 'web',
          mode: clientMode,
        },
        role,
        scopes,
        device: {
          id: identity.deviceId,
          publicKey: identity.publicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        },
        caps: [],
        auth: {
          token: options.token,
        },
        userAgent: navigator.userAgent,
        locale: navigator.language || 'en',
      },
    })
  }

  function handleMessage(msg: Record<string, unknown>) {
    const type = msg.type as string

    if (type === 'res') {
      const id = msg.id as string
      console.log('[WS] res:', id, 'ok:', msg.ok)
      const p = pending.get(id)
      if (p) {
        pending.delete(id)
        if (msg.ok) {
          p.resolve(msg.payload)
        } else {
          const err = msg.error as Record<string, string> | string
          const errMsg = typeof err === 'string' ? err : err?.message || 'RPC error'
          p.reject(new Error(errMsg))
        }
      }
    } else if (type === 'event') {
      const eventName = msg.event as string

      if (eventName === 'connect.challenge') {
        const payload = msg.payload as Record<string, string>
        console.log('[WS] got challenge, sending signed connect...')
        sendConnectReq(payload?.nonce)
        return
      }

      options.onEvent?.(eventName, (msg.payload || msg) as Record<string, unknown>)
    }
  }

  function sendRaw(data: Record<string, unknown>) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    }
  }

  function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = nextId()
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, 30000)

      pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) },
      })

      sendRaw({ type: 'req', id, method, params })
    })
  }

  function flushPending(err: Error) {
    for (const [, p] of pending) p.reject(err)
    pending.clear()
  }

  async function chatHistory(sessionKey: string, limit = 200): Promise<Record<string, unknown>> {
    const result = await rpc('chat.history', { sessionKey, limit })
    return result as Record<string, unknown>
  }

  function chatSend(sessionKey: string, message: string): Promise<unknown> {
    return rpc('chat.send', {
      sessionKey,
      message,
      deliver: false,
      idempotencyKey: `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    })
  }

  function chatAbort(sessionKey: string) {
    sendRaw({
      type: 'req',
      id: nextId(),
      method: 'chat.abort',
      params: { sessionKey },
    })
  }

  function disconnect() {
    shouldReconnect = false
    if (reconnectTimer) clearTimeout(reconnectTimer)
    ws?.close()
    ws = null
    connection.status = 'disconnected'
    flushPending(new Error('disconnected'))
  }

  return {
    connection,
    connect,
    disconnect,
    rpc,
    chatHistory,
    chatSend,
    chatAbort,
  }
}
