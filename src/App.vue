<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import ChatPanel from './components/ChatPanel.vue'
import ConnectionSettings from './components/ConnectionSettings.vue'
import { useGatewayWs } from './composables/useGatewayWs'
import { useNotifications } from './composables/useNotifications'
import type { Agent, ChatMessage, ToolCall, TimelineEntry } from './types'

// Agents loaded dynamically from gateway via agents.list RPC
const agents = reactive<Agent[]>([])
const defaultAgentId = ref('main')

const connected = ref(false)
const activeAgentId = ref('main')
const chatHistories = reactive<Record<string, ChatMessage[]>>({})
const toolCalls = reactive<Record<string, Record<string, ToolCall>>>({})
const unreadCounts = reactive<Record<string, number>>({})
const lastActivity = reactive<Record<string, number>>({})
const notifications = useNotifications()
const connectionError = ref('')
let gateway: ReturnType<typeof useGatewayWs> | null = null

// Session keys: format is "agent:<agentId>:main"
function sessionKeyFor(agentId: string): string {
  return `agent:${agentId}:main`
}

function initAgent(agentId: string) {
  if (!chatHistories[agentId]) chatHistories[agentId] = []
  if (!toolCalls[agentId]) toolCalls[agentId] = {}
  if (!(agentId in unreadCounts)) unreadCounts[agentId] = 0
}

// Sort agents: most recently active first
const sortedAgents = computed(() => {
  return [...agents].sort((a, b) => {
    return (lastActivity[b.id] || 0) - (lastActivity[a.id] || 0)
  })
})

function lastMessagePreview(agentId: string): string {
  const msgs = chatHistories[agentId]
  if (!msgs || msgs.length === 0) return 'No messages yet'
  const last = msgs[msgs.length - 1]
  const prefix = last.role === 'user' ? 'You: ' : ''
  const text = last.content.replace(/\n/g, ' ').slice(0, 60)
  return prefix + text + (last.content.length > 60 ? '...' : '')
}

const activeMessages = computed(() => chatHistories[activeAgentId.value] || [])

const activeTimeline = computed<TimelineEntry[]>(() => {
  const agentId = activeAgentId.value
  const msgs: TimelineEntry[] = (chatHistories[agentId] || []).map(m => ({ kind: 'message' as const, data: m }))
  const tools: TimelineEntry[] = Object.values(toolCalls[agentId] || {}).map(t => ({ kind: 'tool' as const, data: t }))
  return [...msgs, ...tools].sort((a, b) => a.data.timestamp - b.data.timestamp)
})
const activeAgent = computed(() => agents.find((a) => a.id === activeAgentId.value) || { id: 'main', name: 'Agent' })
const isConnected = computed(() => gateway?.connection.status === 'connected')
const isStreaming = computed(() => {
  const msgs = chatHistories[activeAgentId.value]
  return msgs?.some((m) => m.isStreaming) || false
})

// Clear unread when switching tabs
watch(activeAgentId, (id) => {
  unreadCounts[id] = 0
})

function extractText(message: Record<string, unknown>): string {
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return (content as Array<Record<string, string>>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

function handleChatEvent(payload: Record<string, unknown>) {
  const sessionKey = payload.sessionKey as string || ''
  const state = payload.state as string
  const message = payload.message as Record<string, unknown> | undefined
  const text = message ? extractText(message) : ''

  console.log('[Chat]', state, sessionKey, text?.slice(0, 50))

  // Find which agent this session belongs to by matching session key pattern "agent:<agentId>:*"
  const sessionAgentId = sessionKey.split(':')[1] || ''
  const agent = agents.find((a) => a.id === sessionAgentId)
  if (!agent) {
    console.log('[Chat] ignoring event for unknown agent:', sessionAgentId, sessionKey)
    return
  }
  const agentId = agent.id

  if (state === 'delta') {
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    lastActivity[agentId] = Date.now()
    if (last?.isStreaming && last.role === 'assistant') {
      last.content = text
    } else {
      msgs.push({
        id: `stream_${agentId}_${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        agentId,
        isStreaming: true,
      })
    }
  } else if (state === 'final') {
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    lastActivity[agentId] = Date.now()
    if (last?.isStreaming) {
      last.isStreaming = false
      if (text) last.content = text
    } else if (text) {
      msgs.push({
        id: `msg_${agentId}_${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
        agentId,
      })
    }

    // Notify if not active
    if (agentId !== activeAgentId.value) {
      unreadCounts[agentId] = (unreadCounts[agentId] || 0) + 1
      notifications.notify(
        agent.name,
        (text || last?.content || '').slice(0, 100) || 'New message'
      )
    }
  } else if (state === 'error') {
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    if (last?.isStreaming) {
      last.isStreaming = false
      last.content += '\n\n[Error: ' + ((payload.errorMessage as string) || 'unknown') + ']'
    }
  }
}

function resolveAgentFromSession(sessionKey: string): Agent | undefined {
  const sessionAgentId = sessionKey.split(':')[1] || ''
  return agents.find((a) => a.id === sessionAgentId)
}

function handleAgentEvent(payload: Record<string, unknown>) {
  if (payload.stream !== 'tool') return

  const sessionKey = payload.sessionKey as string || ''
  const agent = resolveAgentFromSession(sessionKey)
  if (!agent) return

  const data = payload.data as Record<string, unknown> || {}
  const toolCallId = data.toolCallId as string
  if (!toolCallId) return

  const name = (data.name as string) || 'tool'
  const phase = (data.phase as string) || 'start'
  const args = phase === 'start' ? data.args : undefined
  const output = phase === 'result' ? stringifyResult(data.result) : phase === 'update' ? stringifyResult(data.partialResult) : undefined

  const existing = toolCalls[agent.id]?.[toolCallId]
  if (existing) {
    existing.name = name
    existing.phase = phase as ToolCall['phase']
    if (args !== undefined) existing.args = args
    if (output !== undefined) existing.output = output
  } else {
    if (!toolCalls[agent.id]) toolCalls[agent.id] = {}
    toolCalls[agent.id][toolCallId] = {
      id: `tool_${toolCallId}`,
      toolCallId,
      name,
      phase: phase as ToolCall['phase'],
      args,
      output,
      timestamp: Date.now(),
      agentId: agent.id,
    }
  }
}

function stringifyResult(val: unknown): string {
  if (val === undefined || val === null) return ''
  if (typeof val === 'string') return val
  return JSON.stringify(val, null, 2)
}

async function handleConnect(url: string, token: string) {
  console.log('[App] handleConnect called', url, token ? '(token set)' : '(no token)')
  notifications.requestPermission()

  gateway = useGatewayWs({
    url,
    token,
    onEvent: (event, payload) => {
      if (event === 'chat') {
        handleChatEvent(payload)
      } else if (event === 'agent') {
        handleAgentEvent(payload)
      }
    },
    onConnected: async () => {
      console.log('[App] Connected! Loading agents + histories...')
      connected.value = true
      connectionError.value = ''
      await loadAgents()
      await loadAllHistories()
    },
    onDisconnected: () => {
      console.log('[App] Disconnected, will reconnect...')
    },
  })

  gateway.connect()
}

const HISTORY_PAGE_SIZE = 30
const hasMoreHistory = reactive<Record<string, boolean>>({})

const SYSTEM_PATTERNS = [
  /^System:\s*\[/,
  /^Read HEARTBEAT\.md/,
  /^\[System Message\]/,
  /^Pre-compaction memory flush/,
]

function classifyVisualRole(role: string, content: string): ChatMessage['visualRole'] {
  if (role === 'user' && SYSTEM_PATTERNS.some(p => p.test(content))) {
    return 'system-notice'
  }
  return role as ChatMessage['visualRole']
}

function parseMessages(agentId: string, rawMessages: Array<Record<string, unknown>>, prefix: string): ChatMessage[] {
  return rawMessages.map((m, i) => {
    let content = ''
    const imageUrls: string[] = []
    if (typeof m.content === 'string') {
      content = m.content
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block.type === 'text') {
          content += (content ? '\n' : '') + (block.text as string)
        } else if (block.type === 'image') {
          // Anthropic format: { type: 'image', source: { type: 'base64', media_type, data } }
          const src = block.source as Record<string, string> | undefined
          if (src?.type === 'base64' && src.data) {
            imageUrls.push(`data:${src.media_type || 'image/png'};base64,${src.data}`)
          }
        } else if (block.type === 'image_url') {
          // OpenAI format: { type: 'image_url', image_url: { url } }
          const imgUrl = block.image_url as Record<string, string> | undefined
          if (imgUrl?.url) {
            imageUrls.push(imgUrl.url)
          }
        }
      }
    }
    const role = (m.role as ChatMessage['role']) || 'assistant'
    return {
      id: `${prefix}_${agentId}_${i}`,
      role,
      visualRole: classifyVisualRole(role, content),
      content: content || (imageUrls.length > 0 ? '[image]' : ''),
      timestamp: (m.timestamp as number) || Date.now(),
      agentId,
      attachments: imageUrls.length > 0 ? imageUrls : undefined,
    }
  }).filter((m) => (m.content || m.attachments?.length) && m.role !== 'system')
}

async function loadHistory(agentId: string) {
  if (!gateway) return
  const sk = sessionKeyFor(agentId)
  try {
    const result = await gateway.chatHistory(sk, HISTORY_PAGE_SIZE)
    if (result && Array.isArray(result.messages)) {
      chatHistories[agentId] = parseMessages(agentId, result.messages as Array<Record<string, unknown>>, 'hist')
      hasMoreHistory[agentId] = (result.messages as unknown[]).length >= HISTORY_PAGE_SIZE
      const msgs = chatHistories[agentId]
      if (msgs.length > 0) {
        lastActivity[agentId] = msgs[msgs.length - 1].timestamp
      }
    }
  } catch (e) {
    console.warn(`[App] Failed to load history for ${agentId}:`, e)
  }
}

async function loadAgents() {
  if (!gateway) return
  try {
    const result = await gateway.rpc('agents.list', {}) as { agents: Array<{ id: string; name?: string; default?: boolean }>; defaultId?: string }
    if (result?.agents) {
      agents.length = 0
      for (const a of result.agents) {
        const name = a.name || a.id
        agents.push({ id: a.id, name })
        initAgent(a.id)
      }
      if (result.defaultId) defaultAgentId.value = result.defaultId
      if (!agents.find(a => a.id === activeAgentId.value) && agents.length > 0) {
        activeAgentId.value = agents[0].id
      }
    }
  } catch (e) {
    console.warn('[App] Failed to load agents:', e)
    // Fallback to a single main agent
    if (agents.length === 0) {
      agents.push({ id: 'main', name: 'Agent' })
      initAgent('main')
    }
  }
}

async function loadAllHistories() {
  if (!gateway) return
  for (const agent of agents) {
    await loadHistory(agent.id)
  }
}

function handleSend(payload: { text: string; attachments?: Array<{ dataUrl: string; mimeType: string }> }) {
  const agentId = activeAgentId.value
  const { text, attachments } = payload

  // Add user message locally
  lastActivity[agentId] = Date.now()
  chatHistories[agentId].push({
    id: `user_${Date.now()}`,
    role: 'user',
    visualRole: 'user',
    content: text || (attachments?.length ? '[image]' : ''),
    timestamp: Date.now(),
    agentId,
    attachments: attachments?.map(a => a.dataUrl),
  })

  // Send via WS
  const sk = sessionKeyFor(agentId)
  gateway?.chatSend(sk, text, attachments)
}

function handleAbort() {
  const sk = sessionKeyFor(activeAgentId.value)
  gateway?.chatAbort(sk)
}

function selectAgent(agentId: string) {
  activeAgentId.value = agentId
}
</script>

<template>
  <div class="h-full flex flex-col">
    <template v-if="!connected">
      <ConnectionSettings
        :error="connectionError"
        :connecting="gateway?.connection.status === 'connecting'"
        @connect="handleConnect"
      />
    </template>

    <template v-else>
      <div class="app-layout">
        <!-- Sidebar -->
        <aside class="sidebar">
          <div class="sidebar-header">
            <span class="logo">OpenClaw</span>
            <span class="status-dot" :class="isConnected ? 'online' : 'offline'" />
          </div>
          <nav class="agent-list">
            <button
              v-for="agent in sortedAgents"
              :key="agent.id"
              class="agent-item"
              :class="{ active: agent.id === activeAgentId }"
              @click="selectAgent(agent.id)"
            >
              <div class="agent-avatar" :class="{ active: agent.id === activeAgentId }">
                <span>{{ agent.name[0] }}</span>
              </div>
              <div class="agent-info">
                <span class="agent-name">{{ agent.name }}</span>
                <span class="agent-preview">{{ lastMessagePreview(agent.id) }}</span>
              </div>
              <div class="agent-meta">
                <span
                  v-if="(unreadCounts[agent.id] || 0) > 0"
                  class="badge"
                >
                  {{ unreadCounts[agent.id] }}
                </span>
              </div>
            </button>
          </nav>
        </aside>

        <!-- Chat -->
        <main class="chat-main">
          <ChatPanel
            :messages="activeMessages"
            :timeline="activeTimeline"
            :agent-name="activeAgent.name"
            :is-connected="isConnected"
            :is-streaming="isStreaming"
            @send="handleSend"
            @abort="handleAbort"
          />
        </main>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100%;
}

/* ── Sidebar ── */
.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--surface-secondary);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 20px 16px;
}

.logo {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  transition: background 0.3s;
}
.status-dot.online {
  background: var(--success);
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
}
.status-dot.offline {
  background: var(--danger);
}

.agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.agent-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  cursor: pointer;
  text-align: left;
  font-family: var(--font-sans);
  transition: background 0.15s;
  width: 100%;
}
.agent-item:hover {
  background: var(--surface-tertiary);
}
.agent-item.active {
  background: var(--surface-tertiary);
}

.agent-avatar {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-pill);
  background: var(--surface-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.agent-avatar.active {
  background: var(--accent);
}
.agent-avatar span {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-secondary);
}
.agent-avatar.active span {
  color: var(--accent-text);
}

.agent-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.agent-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.agent-preview {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-meta {
  flex-shrink: 0;
}

.badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-text);
  line-height: 1;
}

/* ── Chat main ── */
.chat-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}
</style>
