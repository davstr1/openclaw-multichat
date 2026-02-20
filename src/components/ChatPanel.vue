<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import type { ChatMessage, TimelineEntry, NarrationGroup } from '../types'
import MarkdownContent from './MarkdownContent.vue'
import ToolCard from './ToolCard.vue'
import { stripInboundMeta } from '../composables/useStripMeta'

const props = defineProps<{
  messages: ChatMessage[]
  timeline: TimelineEntry[]
  agentName: string
  isConnected: boolean
  isStreaming: boolean
  hasMoreHistory: boolean
}>()

const emit = defineEmits<{
  (e: 'send', payload: { text: string; attachments?: Array<{ dataUrl: string; mimeType: string }> }): void
  (e: 'abort'): void
  (e: 'newSession'): void
  (e: 'loadOlder'): void
}>()

const input = ref('')
const attachments = ref<Array<{ id: string; dataUrl: string; mimeType: string }>>([])
const messagesContainer = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()

function handleSend() {
  const text = input.value.trim()
  const atts = attachments.value.length > 0
    ? attachments.value.map(a => ({ dataUrl: a.dataUrl, mimeType: a.mimeType }))
    : undefined
  if (!text && !atts) return
  emit('send', { text, attachments: atts })
  input.value = ''
  attachments.value = []
  if (inputEl.value) inputEl.value.style.height = 'auto'
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      const reader = new FileReader()
      reader.onload = () => {
        attachments.value.push({
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          dataUrl: reader.result as string,
          mimeType: file.type,
        })
      }
      reader.readAsDataURL(file)
    }
  }
}

function removeAttachment(id: string) {
  attachments.value = attachments.value.filter(a => a.id !== id)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 160) + 'px'
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

watch(() => props.timeline.length, scrollToBottom)
watch(() => props.messages[props.messages.length - 1]?.content, scrollToBottom)
onMounted(scrollToBottom)

const loadingOlder = ref(false)

function handleScroll() {
  const el = messagesContainer.value
  if (!el || !props.hasMoreHistory || loadingOlder.value) return
  if (el.scrollTop < 80) {
    loadingOlder.value = true
    const prevHeight = el.scrollHeight
    emit('loadOlder')
    // Preserve scroll position after prepending
    nextTick(() => {
      const newHeight = el.scrollHeight
      el.scrollTop = newHeight - prevHeight
      loadingOlder.value = false
    })
  }
}
</script>

<template>
  <div class="chat-layout">
    <!-- Messages -->
    <div ref="messagesContainer" class="messages-scroll" @scroll="handleScroll">
      <div v-if="hasMoreHistory" class="load-more-hint">
        <span class="load-more-text">↑ Scroll up for older messages</span>
      </div>
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-state-inner">
          <p class="empty-label">{{ agentName }}</p>
          <p class="empty-hint">Start a conversation</p>
        </div>
      </div>

      <div class="messages-list">
        <template v-for="entry in timeline" :key="entry.data.id">
          <!-- Tool call card -->
          <div v-if="entry.kind === 'tool'" class="tool-row">
            <div class="avatar-spacer" />
            <ToolCard :tool="entry.data" />
          </div>

          <!-- System notice (injected by gateway, not the user) -->
          <div v-else-if="entry.data.visualRole === 'system-notice'" class="system-notice-row">
            <div class="system-notice">
              {{ entry.data.content.length > 120 ? stripInboundMeta(entry.data.content).slice(0, 120) + '...' : stripInboundMeta(entry.data.content) }}
            </div>
          </div>

          <!-- Narration group (collapsed working steps) -->
          <div v-else-if="entry.kind === 'narration'" class="message-row assistant">
            <div class="avatar">
              <span class="avatar-letter">{{ agentName[0] }}</span>
            </div>
            <div class="bubble assistant">
              <details class="narration-block">
                <summary class="narration-summary">
                  <span class="narration-icon">🔧</span>
                  Working... <span class="narration-count">({{ (entry.data as NarrationGroup).messages.length }} steps)</span>
                </summary>
                <div class="narration-steps">
                  <div v-for="msg in (entry.data as NarrationGroup).messages" :key="msg.id" class="narration-step">
                    {{ msg.content }}
                  </div>
                </div>
              </details>
            </div>
          </div>

          <!-- Chat message -->
          <div v-else class="message-row" :class="(entry.data as ChatMessage).role">
            <div v-if="entry.data.role === 'assistant'" class="avatar">
              <span class="avatar-letter">{{ agentName[0] }}</span>
            </div>

            <div class="bubble" :class="[entry.data.role, { 'bubble-error': entry.data.isError }]">
              <!-- Thinking block (collapsible) -->
              <details v-if="entry.data.thinking" class="thinking-block" :open="entry.data.isThinking">
                <summary class="thinking-summary">
                  <span class="thinking-icon">{{ entry.data.isThinking ? '⟳' : '💭' }}</span>
                  {{ entry.data.isThinking ? 'Thinking...' : 'Thought process' }}
                </summary>
                <div class="thinking-content">{{ entry.data.thinking }}</div>
              </details>
              <div v-if="entry.data.attachments?.length" class="bubble-attachments">
                <img v-for="(src, idx) in entry.data.attachments" :key="idx" :src="src" class="bubble-image" alt="attachment" />
              </div>
              <MarkdownContent v-if="entry.data.content && entry.data.content !== '[image]'" :content="entry.data.role === 'user' ? stripInboundMeta(entry.data.content) : entry.data.content" />
              <div v-if="entry.data.isStreaming && !entry.data.isThinking" class="streaming-dots">
                <span /><span /><span />
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Input -->
    <div class="input-area">
      <div class="input-container">
        <!-- Attachment preview -->
        <div v-if="attachments.length > 0" class="attachment-preview">
          <div v-for="att in attachments" :key="att.id" class="attachment-thumb">
            <img :src="att.dataUrl" alt="attachment" />
            <button class="attachment-remove" @click="removeAttachment(att.id)">&times;</button>
          </div>
        </div>
        <textarea
          ref="inputEl"
          v-model="input"
          class="chat-input"
          :class="{ 'has-attachments': attachments.length > 0 }"
          :placeholder="isConnected ? `Message ${agentName}...` : 'Disconnected'"
          :disabled="!isConnected"
          rows="1"
          @keydown="handleKeydown"
          @input="autoResize"
          @paste="handlePaste"
        />
        <div class="input-actions">
          <button
            class="btn-new-session"
            title="New session"
            :disabled="isStreaming"
            @click="emit('newSession')"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <button
            v-if="isStreaming"
            class="btn-stop"
            @click="emit('abort')"
          >
            Stop
          </button>
          <button
            v-else
            class="btn-send"
            :disabled="!input.trim() || !isConnected"
            @click="handleSend"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 24px 0;
}

/* Narration / Working block */
.narration-block {
  margin: 0;
  border-radius: 6px;
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.12);
  font-size: 0.8rem;
  overflow: hidden;
}
.narration-summary {
  cursor: pointer;
  padding: 6px 10px;
  color: rgba(245, 158, 11, 0.8);
  font-size: 0.75rem;
  user-select: none;
  list-style: none;
}
.narration-summary::-webkit-details-marker { display: none; }
.narration-summary::before {
  content: '▸ ';
  font-size: 0.7rem;
}
details[open] .narration-summary::before {
  content: '▾ ';
}
.narration-icon { margin-right: 4px; }
.narration-count {
  color: rgba(245, 158, 11, 0.5);
  font-size: 0.7rem;
}
.narration-steps {
  padding: 6px 10px;
  border-top: 1px solid rgba(245, 158, 11, 0.08);
}
.narration-step {
  padding: 3px 0;
  color: var(--text-muted, #888);
  font-size: 0.75rem;
  line-height: 1.4;
  border-bottom: 1px solid rgba(255,255,255,0.03);
}
.narration-step:last-child { border-bottom: none; }

/* Thinking block */
.thinking-block {
  margin-bottom: 8px;
  border-radius: 6px;
  background: rgba(139, 92, 246, 0.08);
  border: 1px solid rgba(139, 92, 246, 0.15);
  font-size: 0.8rem;
  overflow: hidden;
}
.thinking-summary {
  cursor: pointer;
  padding: 6px 10px;
  color: rgba(139, 92, 246, 0.8);
  font-size: 0.75rem;
  user-select: none;
  list-style: none;
}
.thinking-summary::-webkit-details-marker { display: none; }
.thinking-summary::before {
  content: '▸ ';
  font-size: 0.7rem;
}
details[open] .thinking-summary::before {
  content: '▾ ';
}
.thinking-icon {
  margin-right: 4px;
}
.thinking-content {
  padding: 8px 10px;
  border-top: 1px solid rgba(139, 92, 246, 0.1);
  color: var(--text-muted, #888);
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 300px;
  overflow-y: auto;
}

.load-more-hint {
  text-align: center;
  padding: 12px 0 8px;
  opacity: 0.5;
  font-size: 0.75rem;
}

.load-more-text {
  color: var(--text-muted, #888);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.empty-state-inner {
  text-align: center;
}
.empty-label {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}
.empty-hint {
  font-size: 14px;
  color: var(--text-muted);
}

.messages-list {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message-row {
  display: flex;
  gap: 12px;
  animation: fadeIn 0.2s ease;
}
.message-row.user {
  justify-content: flex-end;
}
.message-row.assistant {
  justify-content: flex-start;
  align-items: flex-start;
}

.tool-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  animation: fadeIn 0.2s ease;
}

.avatar-spacer {
  width: 28px;
  flex-shrink: 0;
}

.system-notice-row {
  display: flex;
  justify-content: center;
}
.system-notice {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-pill);
  padding: 4px 16px;
  max-width: 80%;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 2px;
}
.avatar-letter {
  color: var(--accent-text);
  font-size: 12px;
  font-weight: 700;
}

.bubble {
  max-width: 72%;
  padding: 12px 16px;
  border-radius: 18px;
  font-size: 14px;
  line-height: 1.6;
}

.bubble.user {
  background: var(--accent);
  color: var(--accent-text);
  border-bottom-right-radius: 6px;
}
.bubble.assistant {
  background: var(--surface-secondary);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
  border-bottom-left-radius: 6px;
}

.bubble-error {
  border-color: rgba(239, 68, 68, 0.3) !important;
  background: rgba(239, 68, 68, 0.06) !important;
}
.bubble-error::before {
  content: '⚠️ Error';
  display: block;
  font-size: 0.7rem;
  font-weight: 600;
  color: rgb(239, 68, 68);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* Bubble attachments */
.bubble-attachments {
  margin-bottom: 8px;
}
.bubble-image {
  max-width: 100%;
  max-height: 300px;
  border-radius: var(--radius-md);
  object-fit: contain;
}

/* Input area */
.input-area {
  padding: 16px 24px 24px;
}

.input-container {
  max-width: 800px;
  margin: 0 auto;
  position: relative;
  background: var(--surface-secondary);
  border: 1px solid var(--border-default);
  border-radius: 20px;
  transition: border-color 0.2s;
}
.input-container:focus-within {
  border-color: var(--accent);
}

/* Attachment preview in input */
.attachment-preview {
  display: flex;
  gap: 8px;
  padding: 12px 16px 0;
  flex-wrap: wrap;
}
.attachment-thumb {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: var(--radius-md);
  overflow: hidden;
  border: 1px solid var(--border-subtle);
}
.attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.attachment-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.attachment-remove:hover {
  background: var(--danger);
}

.chat-input {
  width: 100%;
  background: transparent;
  color: var(--text-primary);
  border: none;
  padding: 14px 56px 14px 20px;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: var(--font-sans);
  line-height: 1.5;
}
.chat-input::placeholder {
  color: var(--text-muted);
}
.chat-input:disabled {
  opacity: 0.4;
}

.input-actions {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  gap: 4px;
}

.btn-send {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.btn-send:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-send:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.btn-new-session {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.btn-new-session:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--text-secondary);
}
.btn-new-session:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.btn-stop {
  padding: 6px 14px;
  background: var(--danger);
  color: white;
  border: none;
  border-radius: var(--radius-pill);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  font-family: var(--font-sans);
  transition: opacity 0.15s;
}
.btn-stop:hover {
  opacity: 0.9;
}

/* Streaming dots */
.streaming-dots {
  display: flex;
  gap: 4px;
  margin-top: 8px;
}
.streaming-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: pulse 1.4s infinite ease-in-out;
}
.streaming-dots span:nth-child(2) { animation-delay: 0.2s; }
.streaming-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
