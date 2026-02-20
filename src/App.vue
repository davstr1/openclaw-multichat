<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
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
const pendingNewSession = reactive<Record<string, boolean>>({})
// Track active runId per agent for abort functionality
const activeRunIds = reactive<Record<string, string | null>>({})
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

// Detect narration/working messages: short assistant messages that are just status updates
function isNarrationMessage(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.isStreaming) return false
  const c = msg.content.trim()
  if (!c || c.length > 200) return false
  // Narration patterns: starts with "Let me", "Now ", "I'll ", "I need to", "Good", "OK", etc.
  // and doesn't contain code blocks or links (those are real content)
  if (c.includes('```') || c.includes('http')) return false
  // Short messages between tool calls are likely narration
  const narrationStarts = /^(Let me|Now |I'll |I need |Good|OK|Alright|Perfect|Great|Done|Here's what|Looking at|Checking|Found|Updated|Building|Testing|Clean|Confirmed)/i
  return narrationStarts.test(c)
}

const activeTimeline = computed<TimelineEntry[]>(() => {
  const agentId = activeAgentId.value
  const allEntries: TimelineEntry[] = [
    ...(chatHistories[agentId] || []).map(m => ({ kind: 'message' as const, data: m })),
    ...Object.values(toolCalls[agentId] || {}).map(t => ({ kind: 'tool' as const, data: t })),
  ].sort((a, b) => a.data.timestamp - b.data.timestamp)

  // Group consecutive narration messages
  const result: TimelineEntry[] = []
  let narrationBuffer: ChatMessage[] = []

  function flushNarration() {
    if (narrationBuffer.length >= 2) {
      result.push({
        kind: 'narration',
        data: {
          id: `narr_${narrationBuffer[0].id}`,
          messages: [...narrationBuffer],
          timestamp: narrationBuffer[0].timestamp,
        },
      })
    } else if (narrationBuffer.length === 1) {
      // Single narration message — just show as normal
      result.push({ kind: 'message', data: narrationBuffer[0] })
    }
    narrationBuffer = []
  }

  for (const entry of allEntries) {
    if (entry.kind === 'message' && isNarrationMessage(entry.data as ChatMessage)) {
      narrationBuffer.push(entry.data as ChatMessage)
    } else {
      flushNarration()
      result.push(entry)
    }
  }
  flushNarration()

  return result
})
const activeAgent = computed(() => agents.find((a) => a.id === activeAgentId.value) || { id: 'main', name: 'Agent' })
const isConnected = computed(() => gateway?.connection.status === 'connected')
const isStreaming = computed(() => {
  const agentId = activeAgentId.value
  const msgs = chatHistories[agentId]
  return msgs?.some((m) => m.isStreaming) || !!activeRunIds[agentId]
})

// Clear unread when switching tabs
watch(activeAgentId, (id) => {
  unreadCounts[id] = 0
})

/** Detect NO_REPLY / HEARTBEAT_OK silent tokens */
function isSilentReply(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  // Exact match or starts/ends with token
  if (/^\s*NO_REPLY(?:\s|$)/.test(t)) return true
  if (/\bNO_REPLY\b\W*$/.test(t)) return true
  // HEARTBEAT_OK on its own
  if (/^\s*HEARTBEAT_OK\s*$/.test(t)) return true
  return false
}

/** Detect tool result / gateway send output that shouldn't be shown as chat text */
function isToolResultJson(text: string): boolean {
  if (!text) return false
  const t = text.trim()
  // Regex-based: detect message tool results even with malformed JSON (semicolons, etc.)
  // Look for typical gateway send result patterns
  if (/"channel"\s*:\s*"(whatsapp|telegram|signal|discord|imessage)"/.test(t) &&
      (/"mediaUrl"/.test(t) || /"result"/.test(t) || /"via"\s*:\s*"gateway"/.test(t))) {
    return true
  }
  // Also catch MEDIA: file paths
  if (/^MEDIA:/.test(t)) return true
  return false
}

/** Extract a friendly summary from tool result text for display */
function toolResultSummary(text: string): string {
  const t = text.trim()
  // Extract filename from mediaUrl path
  const mediaMatch = t.match(/"mediaUrl"\s*:\s*"([^"]+)"/)
  const channelMatch = t.match(/"channel"\s*:\s*"([^"]+)"/)
  const toMatch = t.match(/"to"\s*:\s*"([^"]+)"/)

  if (mediaMatch) {
    const filename = mediaMatch[1].split('/').pop() || 'file'
    const channel = channelMatch?.[1] || 'message'
    const to = toMatch?.[1] || ''
    return `Sent ${filename}${to ? ' to ' + to : ''} via ${channel}`
  }

  if (channelMatch && /"messageId"/.test(t)) {
    return `Message sent via ${channelMatch[1]}`
  }

  // MEDIA: token
  if (/^MEDIA:/.test(t)) {
    const path = t.replace(/^MEDIA:\s*/, '').trim()
    return `Sent ${path.split('/').pop() || 'media'}`
  }

  return ''
}

/** Extract local media path from tool result and convert to serveable URL */
function extractMediaPath(text: string): string | null {
  const t = text.trim()
  const match = t.match(/"mediaUrl"\s*:\s*"([^"]+)"/)
  if (!match) return null
  const filePath = match[1]
  // Convert local path to gateway media proxy URL
  // OpenClaw gateway serves local files via /media/ endpoint
  if (filePath.startsWith('/')) {
    return `/api/media?path=${encodeURIComponent(filePath)}`
  }
  return filePath
}

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

function extractThinking(message: Record<string, unknown>): string {
  const content = message?.content
  if (!Array.isArray(content)) return ''
  return (content as Array<Record<string, string>>)
    .filter((b) => b.type === 'thinking')
    .map((b) => b.thinking || b.text || '')
    .join('\n')
}

/**
 * DIRTY QUICK FIX: Deduplicate messages received from multiple WebSocket connections.
 * The Control UI / gateway sometimes delivers the same message to multiple active WS
 * connections for the same session (zombie connections on reconnect). This causes
 * duplicate messages in the chat. We track recent message hashes and skip exact dupes.
 * TODO: Proper fix is to ensure only one WS connection per session is active at a time.
 */
const recentMessageHashes = new Map<string, number>() // hash -> timestamp
const DEDUP_WINDOW_MS = 3000

function dedupeKey(agentId: string, state: string, text: string): string {
  return `${agentId}:${state}:${text.slice(0, 200)}`
}

function isDuplicate(agentId: string, state: string, text: string): boolean {
  // Only dedup final messages — deltas are expected to repeat during streaming
  if (state !== 'final') return false
  const key = dedupeKey(agentId, state, text)
  const now = Date.now()
  const prev = recentMessageHashes.get(key)
  if (prev && now - prev < DEDUP_WINDOW_MS) {
    console.log('[Chat] Dropping duplicate message:', key.slice(0, 80))
    return true
  }
  recentMessageHashes.set(key, now)
  // Cleanup old entries
  if (recentMessageHashes.size > 50) {
    for (const [k, t] of recentMessageHashes) {
      if (now - t > DEDUP_WINDOW_MS) recentMessageHashes.delete(k)
    }
  }
  return false
}

function handleChatEvent(payload: Record<string, unknown>) {
  const sessionKey = payload.sessionKey as string || ''
  const state = payload.state as string
  const message = payload.message as Record<string, unknown> | undefined
  const text = message ? extractText(message) : ''
  const thinking = message ? extractThinking(message) : ''

  console.log('[Chat]', state, sessionKey, text?.slice(0, 50))

  // Find which agent this session belongs to by matching session key pattern "agent:<agentId>:*"
  const sessionAgentId = sessionKey.split(':')[1] || ''
  const agent = agents.find((a) => a.id === sessionAgentId)
  if (!agent) {
    console.log('[Chat] ignoring event for unknown agent:', sessionAgentId, sessionKey)
    return
  }
  const agentId = agent.id

  // DIRTY QUICK FIX: skip duplicate final messages from zombie WS connections
  if (isDuplicate(agentId, state, text)) return

  // Track runId for abort functionality
  const runId = payload.runId as string | undefined
  if (runId && (state === 'delta' || state === 'streaming')) {
    activeRunIds[agentId] = runId
  }
  if (state === 'final' || state === 'error' || state === 'aborted') {
    activeRunIds[agentId] = null
  }

  // Show typing dots as soon as agent starts processing (before first delta)
  if (state === 'streaming') {
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    lastActivity[agentId] = Date.now()
    if (!last?.isStreaming) {
      msgs.push({
        id: `stream_${agentId}_${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        agentId,
        isStreaming: true,
      })
    }
    return
  }

  if (state === 'aborted') {
    // Handle abort: finalize streaming message with whatever content we have
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    if (last?.isStreaming) {
      last.isStreaming = false
      // Keep partial content if any, otherwise remove the placeholder
      if (!last.content?.trim()) {
        msgs.pop()
      }
    }
    return
  }

  if (state === 'delta') {
    if (pendingNewSession[agentId]) return // suppress streaming during /new reset
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    lastActivity[agentId] = Date.now()
    // Suppress tool result JSON during streaming — final handler will display it properly
    const displayText = isToolResultJson(text) ? '' : text

    // Update thinking content on streaming message
    if (thinking && last?.isStreaming && last.role === 'assistant') {
      last.thinking = thinking
      last.isThinking = !displayText // still thinking if no text content yet
    }

    if (last?.isStreaming && last.role === 'assistant') {
      // When text arrives after thinking, mark thinking as done
      if (displayText && last.isThinking) {
        last.isThinking = false
      }
      // Detect new assistant turn: if new text is shorter and doesn't start with
      // existing content, the gateway reset cumulative text for a new turn.
      const prevContent = last.content || ''
      if (prevContent.length > 20 && displayText.length > 0 && displayText.length < prevContent.length * 0.5 && !prevContent.startsWith(displayText)) {
        last.isStreaming = false
        if (!last.content?.trim() && !last.thinking?.trim()) {
          msgs.pop()
        }
        msgs.push({
          id: `stream_${agentId}_${Date.now()}`,
          role: 'assistant',
          content: displayText,
          thinking: thinking || undefined,
          timestamp: Date.now(),
          agentId,
          isStreaming: true,
        })
      } else {
        if (displayText || !thinking) last.content = displayText
      }
    } else {
      if (!displayText && !thinking) return // Don't create a streaming placeholder for tool result JSON
      msgs.push({
        id: `stream_${agentId}_${Date.now()}`,
        role: 'assistant',
        content: displayText,
        thinking: thinking || undefined,
        isThinking: !!thinking && !displayText,
        timestamp: Date.now(),
        agentId,
        isStreaming: true,
      })
    }
  } else if (state === 'final') {
    const msgs = chatHistories[agentId]
    const last = msgs[msgs.length - 1]
    lastActivity[agentId] = Date.now()

    // Suppress the system response after /new (session reset)
    if (pendingNewSession[agentId]) {
      delete pendingNewSession[agentId]
      if (last?.isStreaming) msgs.pop()
      return
    }

    // Resolve final text
    let finalText = text || last?.content || ''

    // Suppress NO_REPLY / HEARTBEAT_OK silent tokens
    if (isSilentReply(finalText)) {
      if (last?.isStreaming) msgs.pop() // remove streaming placeholder
      return
    }

    // Convert tool result JSON to friendly summary + extract media
    if (isToolResultJson(finalText)) {
      const summary = toolResultSummary(finalText)
      const mediaPath = extractMediaPath(finalText)
      finalText = summary || ''
      
      if (last?.isStreaming) {
        if (!finalText && !mediaPath) { msgs.pop(); return }
        last.isStreaming = false
        last.content = finalText
        if (mediaPath) last.attachments = [mediaPath]
      } else if (finalText || mediaPath) {
        msgs.push({
          id: `msg_${agentId}_${Date.now()}`,
          role: 'assistant',
          content: finalText,
          timestamp: Date.now(),
          agentId,
          attachments: mediaPath ? [mediaPath] : undefined,
        })
      }

      if (agentId !== activeAgentId.value) {
        unreadCounts[agentId] = (unreadCounts[agentId] || 0) + 1
        notifications.notify(agent.name, finalText || 'Sent media')
      }
      return
    }

    if (last?.isStreaming) {
      last.isStreaming = false
      last.isThinking = false
      last.content = finalText
      if (thinking) last.thinking = thinking
    } else if (finalText) {
      msgs.push({
        id: `msg_${agentId}_${Date.now()}`,
        role: 'assistant',
        content: finalText,
        thinking: thinking || undefined,
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

const HISTORY_FETCH_SIZE = 200  // Fetch big batch from gateway
const HISTORY_PAGE_SIZE = 30     // Show this many at a time
const hasMoreHistory = reactive<Record<string, boolean>>({})
// Full fetched history buffer (all messages from gateway, not yet displayed)
const fullHistoryBuffer = reactive<Record<string, ChatMessage[]>>({})

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
    let thinkingText = ''
    const imageUrls: string[] = []
    if (typeof m.content === 'string') {
      content = m.content
    } else if (Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block.type === 'text') {
          content += (content ? '\n' : '') + (block.text as string)
        } else if (block.type === 'thinking') {
          const t = (block.thinking || block.text || '') as string
          thinkingText += (thinkingText ? '\n' : '') + t
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
      thinking: thinkingText || undefined,
      timestamp: (m.timestamp as number) || Date.now(),
      agentId,
      attachments: imageUrls.length > 0 ? imageUrls : undefined,
    }
  }).filter((m) => {
    if (m.role === 'system') return false
    if (!m.content && !m.attachments?.length) return false
    // Filter silent replies
    if (m.role === 'assistant' && isSilentReply(m.content)) return false
    // Catch tool result JSON on ANY role (assistant, tool, tool_result)
    // Convert to friendly summary + image, or hide entirely
    if (isToolResultJson(m.content)) {
      const summary = toolResultSummary(m.content)
      const mediaPath = extractMediaPath(m.content)
      if (mediaPath) m.attachments = [mediaPath]
      if (summary) { m.content = summary; m.role = 'assistant' } else if (!mediaPath) { return false } else { m.content = ''; m.role = 'assistant' }
    }
    // Hide raw tool role messages (tool call results without media) — shown as tool cards via agent events
    const roleLower = (m.role as string)?.toLowerCase() || ''
    if (roleLower === 'tool' || roleLower === 'tool_result' || roleLower === 'toolresult') return false
    return true
  })
}

async function loadHistory(agentId: string) {
  if (!gateway) return
  const sk = sessionKeyFor(agentId)
  try {
    const result = await gateway.chatHistory(sk, HISTORY_FETCH_SIZE)
    if (result && Array.isArray(result.messages)) {
      const allMessages = parseMessages(agentId, result.messages as Array<Record<string, unknown>>, 'hist')
      // Store full buffer, display only last page
      if (allMessages.length > HISTORY_PAGE_SIZE) {
        const displayStart = allMessages.length - HISTORY_PAGE_SIZE
        fullHistoryBuffer[agentId] = allMessages.slice(0, displayStart)
        chatHistories[agentId] = allMessages.slice(displayStart)
        hasMoreHistory[agentId] = true
      } else {
        fullHistoryBuffer[agentId] = []
        chatHistories[agentId] = allMessages
        hasMoreHistory[agentId] = false
      }
      const msgs = chatHistories[agentId]
      if (msgs.length > 0) {
        lastActivity[agentId] = msgs[msgs.length - 1].timestamp
      }
    }
  } catch (e) {
    console.warn(`[App] Failed to load history for ${agentId}:`, e)
  }
}

function loadOlderMessages(agentId: string) {
  const buffer = fullHistoryBuffer[agentId]
  if (!buffer || buffer.length === 0) {
    hasMoreHistory[agentId] = false
    return
  }
  // Take the next page from the buffer
  const pageStart = Math.max(0, buffer.length - HISTORY_PAGE_SIZE)
  const page = buffer.slice(pageStart)
  fullHistoryBuffer[agentId] = buffer.slice(0, pageStart)
  // Prepend to displayed messages
  chatHistories[agentId] = [...page, ...chatHistories[agentId]]
  hasMoreHistory[agentId] = pageStart > 0
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
  const agentId = activeAgentId.value
  const sk = sessionKeyFor(agentId)
  const runId = activeRunIds[agentId] || undefined
  gateway?.chatAbort(sk, runId)
}

function handleNewSession() {
  // The gateway treats "/new" as a command to reset the session context.
  // Same mechanism as the native Control UI's "New Session" button.
  const agentId = activeAgentId.value
  const sk = sessionKeyFor(agentId)
  pendingNewSession[agentId] = true
  gateway?.chatSend(sk, '/new')
  // Clear local state for this agent
  chatHistories[agentId] = []
  toolCalls[agentId] = {}
  activeRunIds[agentId] = null
}

function selectAgent(agentId: string) {
  activeAgentId.value = agentId
}

// Persist active agent to localStorage
watch(activeAgentId, (id) => {
  localStorage.setItem('oc-active-agent', id)
})

// Auto-connect on mount if we have saved credentials
onMounted(() => {
  const savedUrl = localStorage.getItem('oc-gateway-url')
  const savedToken = localStorage.getItem('oc-gateway-token')
  const savedAgent = localStorage.getItem('oc-active-agent')
  if (savedAgent) activeAgentId.value = savedAgent
  if (savedUrl && savedToken) {
    handleConnect(savedUrl, savedToken)
  }
})
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
            :has-more-history="!!hasMoreHistory[activeAgentId]"
            @send="handleSend"
            @abort="handleAbort"
            @new-session="handleNewSession"
            @load-older="loadOlderMessages(activeAgentId)"
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
