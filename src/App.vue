<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import AgentTabs from './components/AgentTabs.vue'
import ChatPanel from './components/ChatPanel.vue'
import ConnectionSettings from './components/ConnectionSettings.vue'
import { useGatewayWs } from './composables/useGatewayWs'
import { useNotifications } from './composables/useNotifications'
import type { Agent, ChatMessage } from './types'

const agents: Agent[] = [
  { id: 'main', name: 'Kai-1', label: 'K1' },
  { id: 'kai-2', name: 'Kai-2', label: 'K2' },
  { id: 'kai-3', name: 'Kai-3', label: 'K3' },
  { id: 'kai-4', name: 'Kai-4', label: 'K4' },
]

const connected = ref(false)
const activeAgentId = ref('main')
const chatHistories = reactive<Record<string, ChatMessage[]>>({})
const unreadCounts = reactive<Record<string, number>>({})
const notifications = useNotifications()
const connectionError = ref('')
let gateway: ReturnType<typeof useGatewayWs> | null = null

// Session keys: format is "agent:<agentId>:main"
function sessionKeyFor(agentId: string): string {
  return `agent:${agentId}:main`
}

// Init empty histories
agents.forEach((a) => {
  chatHistories[a.id] = []
  unreadCounts[a.id] = 0
})

const activeMessages = computed(() => chatHistories[activeAgentId.value] || [])
const activeAgent = computed(() => agents.find((a) => a.id === activeAgentId.value)!)
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
        `${agent.label || ''} ${agent.name}`,
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

async function handleConnect(url: string, token: string) {
  console.log('[App] handleConnect called', url, token ? '(token set)' : '(no token)')
  notifications.requestPermission()

  gateway = useGatewayWs({
    url,
    token,
    onEvent: (event, payload) => {
      if (event === 'chat') {
        handleChatEvent(payload)
      }
    },
    onConnected: async () => {
      console.log('[App] Connected! Loading histories...')
      connected.value = true
      connectionError.value = ''
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

agents.forEach((a) => { hasMoreHistory[a.id] = true })

function parseMessages(agentId: string, rawMessages: Array<Record<string, unknown>>, prefix: string): ChatMessage[] {
  return rawMessages.map((m, i) => {
    let content = ''
    if (typeof m.content === 'string') {
      content = m.content
    } else if (Array.isArray(m.content)) {
      content = (m.content as Array<Record<string, string>>)
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
    }
    return {
      id: `${prefix}_${agentId}_${i}`,
      role: (m.role as ChatMessage['role']) || 'assistant',
      content,
      timestamp: (m.timestamp as number) || Date.now(),
      agentId,
    }
  }).filter((m) => m.content && m.role !== 'system')
}

async function loadHistory(agentId: string) {
  if (!gateway) return
  const sk = sessionKeyFor(agentId)
  try {
    const result = await gateway.chatHistory(sk, HISTORY_PAGE_SIZE)
    if (result && Array.isArray(result.messages)) {
      chatHistories[agentId] = parseMessages(agentId, result.messages as Array<Record<string, unknown>>, 'hist')
      hasMoreHistory[agentId] = (result.messages as unknown[]).length >= HISTORY_PAGE_SIZE
    }
  } catch (e) {
    console.warn(`[App] Failed to load history for ${agentId}:`, e)
  }
}

async function loadAllHistories() {
  if (!gateway) return
  for (const agent of agents) {
    await loadHistory(agent.id)
  }
}

function handleSend(text: string) {
  const agentId = activeAgentId.value

  // Add user message locally
  chatHistories[agentId].push({
    id: `user_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
    agentId,
  })

  // Send via WS
  const sk = sessionKeyFor(agentId)
  gateway?.chatSend(sk, text)
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
      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-3 bg-[var(--surface-secondary)] border-b border-[var(--border-default)]">
        <h1 class="text-lg font-bold">OpenClaw Multichat</h1>
        <div class="flex items-center gap-2">
          <span
            class="w-2 h-2 rounded-full"
            :class="isConnected ? 'bg-[var(--success)]' : 'bg-[var(--danger)]'"
          />
          <span class="text-xs text-[var(--text-muted)]">
            {{ isConnected ? 'Connected' : 'Disconnected' }}
          </span>
        </div>
      </div>

      <!-- Tabs -->
      <AgentTabs
        :agents="agents"
        :active-agent-id="activeAgentId"
        :unread-counts="unreadCounts"
        @select="selectAgent"
      />

      <!-- Chat -->
      <div class="flex-1 overflow-hidden">
        <ChatPanel
          :messages="activeMessages"
          :agent-name="activeAgent.name"
          :is-connected="isConnected"
          :is-streaming="isStreaming"
          @send="handleSend"
          @abort="handleAbort"
        />
      </div>
    </template>
  </div>
</template>
