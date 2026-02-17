export interface Agent {
  id: string
  name: string
  emoji?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  agentId: string
  isStreaming?: boolean
}

export interface WsMessage {
  type: string
  id?: string
  [key: string]: unknown
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
}
