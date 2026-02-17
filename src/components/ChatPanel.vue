<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import type { ChatMessage, TimelineEntry } from '../types'
import MarkdownContent from './MarkdownContent.vue'
import ToolCard from './ToolCard.vue'

const props = defineProps<{
  messages: ChatMessage[]
  timeline: TimelineEntry[]
  agentName: string
  isConnected: boolean
  isStreaming: boolean
}>()

const emit = defineEmits<{
  (e: 'send', text: string): void
  (e: 'abort'): void
}>()

const input = ref('')
const messagesContainer = ref<HTMLElement>()
const inputEl = ref<HTMLTextAreaElement>()

function handleSend() {
  const text = input.value.trim()
  if (!text) return
  emit('send', text)
  input.value = ''
  // Reset textarea height
  if (inputEl.value) inputEl.value.style.height = 'auto'
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
</script>

<template>
  <div class="chat-layout">
    <!-- Messages -->
    <div ref="messagesContainer" class="messages-scroll">
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

          <!-- Chat message -->
          <div v-else class="message-row" :class="entry.data.role">
            <div v-if="entry.data.role === 'assistant'" class="avatar">
              <span class="avatar-letter">{{ agentName[0] }}</span>
            </div>

            <div class="bubble" :class="entry.data.role">
              <MarkdownContent :content="entry.data.content" />
              <div v-if="entry.data.isStreaming" class="streaming-dots">
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
        <textarea
          ref="inputEl"
          v-model="input"
          class="chat-input"
          :placeholder="isConnected ? `Message ${agentName}...` : 'Disconnected'"
          :disabled="!isConnected"
          rows="1"
          @keydown="handleKeydown"
          @input="autoResize"
        />
        <div class="input-actions">
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
