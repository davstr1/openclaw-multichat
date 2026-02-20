export interface Agent {
  id: string
  name: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  visualRole?: 'user' | 'assistant' | 'system-notice'
  content: string
  thinking?: string
  timestamp: number
  agentId: string
  isStreaming?: boolean
  isThinking?: boolean
  isError?: boolean
  attachments?: string[]
}

export interface ToolCall {
  id: string
  toolCallId: string
  name: string
  phase: 'start' | 'update' | 'result'
  args?: unknown
  output?: string
  timestamp: number
  agentId: string
}

export interface NarrationGroup {
  id: string
  messages: ChatMessage[]
  timestamp: number
}

export type TimelineEntry =
  | { kind: 'message'; data: ChatMessage }
  | { kind: 'tool'; data: ToolCall }
  | { kind: 'narration'; data: NarrationGroup }

export interface WsMessage {
  type: string
  id?: string
  [key: string]: unknown
}

export interface ConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
}
