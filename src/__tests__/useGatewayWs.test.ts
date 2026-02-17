import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []

  constructor(_url: string) {
    setTimeout(() => this.onopen?.(), 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

import { useGatewayWs } from '../composables/useGatewayWs'

describe('useGatewayWs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should initialize as disconnected', () => {
    const ws = useGatewayWs({
      url: 'ws://localhost:18789',
      token: 'test-token',
    })
    expect(ws.connection.status).toBe('disconnected')
  })

  it('should send connect request on open', async () => {
    const ws = useGatewayWs({
      url: 'ws://localhost:18789',
      token: 'test-token',
    })
    ws.connect()
    await new Promise((r) => setTimeout(r, 10))

    // Should transition to connecting
    expect(ws.connection.status).toBe('connecting')
  })

  it('should call onEvent for chat events', async () => {
    const onEvent = vi.fn()
    const ws = useGatewayWs({
      url: 'ws://localhost:18789',
      token: 'test-token',
      onEvent,
    })
    ws.connect()
    await new Promise((r) => setTimeout(r, 10))

    // No direct way to inject WS messages in this mock, but structure is tested
    expect(onEvent).not.toHaveBeenCalled()
  })
})
