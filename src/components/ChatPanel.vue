<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue'
import type { ChatMessage } from '../types'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{
  messages: ChatMessage[]
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

function handleSend() {
  const text = input.value.trim()
  if (!text) return
  emit('send', text)
  input.value = ''
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

watch(() => props.messages.length, scrollToBottom)
watch(() => props.messages[props.messages.length - 1]?.content, scrollToBottom)
onMounted(scrollToBottom)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- Messages -->
    <div
      ref="messagesContainer"
      class="flex-1 overflow-y-auto px-6 py-4 space-y-4"
    >
      <div v-if="messages.length === 0" class="flex items-center justify-center h-full">
        <p class="text-[var(--text-muted)]">Start a conversation with {{ agentName }}</p>
      </div>

      <div
        v-for="msg in messages"
        :key="msg.id"
        class="message"
        :class="msg.role"
      >
        <div class="message-bubble" :class="msg.role">
          <MarkdownContent :content="msg.content" />
          <div v-if="msg.isStreaming" class="streaming-indicator">
            <span class="dot" /><span class="dot" /><span class="dot" />
          </div>
        </div>
      </div>
    </div>

    <!-- Input -->
    <div class="px-6 py-4 border-t border-[var(--border-default)] bg-[var(--surface-secondary)]">
      <div class="flex gap-2">
        <textarea
          v-model="input"
          class="chat-input"
          :placeholder="isConnected ? `Message ${agentName}...` : 'Disconnected'"
          :disabled="!isConnected"
          rows="1"
          @keydown="handleKeydown"
        />
        <button
          v-if="isStreaming"
          class="send-button stop"
          @click="emit('abort')"
        >
          Stop
        </button>
        <button
          v-else
          class="send-button"
          :disabled="!input.trim() || !isConnected"
          @click="handleSend"
        >
          Send
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.message {
  display: flex;
}
.message.user {
  justify-content: flex-end;
}
.message.assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: 75%;
  padding: 12px 16px;
  border-radius: var(--radius-card);
  font-size: 14px;
  line-height: 1.5;
}
.message-bubble.user {
  background: var(--accent);
  color: white;
  border-bottom-right-radius: 4px;
}
.message-bubble.assistant {
  background: var(--surface-tertiary);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
}

.chat-input {
  flex: 1;
  background: var(--surface-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-input);
  padding: 8px 12px;
  font-size: 14px;
  resize: none;
  outline: none;
  font-family: inherit;
}
.chat-input:focus {
  border-color: var(--accent);
}
.chat-input:disabled {
  opacity: 0.5;
}

.send-button {
  padding: 8px 16px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-button);
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: background 0.15s;
}
.send-button:hover:not(:disabled) {
  background: var(--accent-hover);
}
.send-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.send-button.stop {
  background: var(--danger);
}

.streaming-indicator {
  display: flex;
  gap: 4px;
  margin-top: 4px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: pulse 1.4s infinite ease-in-out;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}
</style>
