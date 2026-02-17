<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  error?: string
  connecting?: boolean
}>()

const emit = defineEmits<{
  (e: 'connect', url: string, token: string): void
}>()

const url = ref(localStorage.getItem('oc-gateway-url') || 'ws://127.0.0.1:18789')
const token = ref(localStorage.getItem('oc-gateway-token') || '')
const showToken = ref(false)

function handleConnect() {
  console.log('[ConnectionSettings] handleConnect called', url.value, token.value ? '(token set)' : '(no token)')
  localStorage.setItem('oc-gateway-url', url.value)
  localStorage.setItem('oc-gateway-token', token.value)
  emit('connect', url.value, token.value)
}
</script>

<template>
  <div class="flex items-center justify-center h-full">
    <div class="settings-card">
      <h2 class="text-xl font-bold mb-6">Connect to Gateway</h2>

      <!-- Error -->
      <div v-if="props.error" class="mb-4 p-3 rounded-lg bg-danger/10 border border-danger/30 text-sm text-danger">
        {{ props.error }}
      </div>

      <!-- Connecting -->
      <div v-if="props.connecting" class="mb-4 p-3 rounded-lg bg-info/10 border border-info/30 text-sm text-info">
        Connecting...
      </div>

      <div class="space-y-4">
        <div>
          <label class="block text-sm text-[var(--text-secondary)] mb-1">Gateway URL</label>
          <input
            v-model="url"
            type="text"
            class="settings-input"
            placeholder="ws://127.0.0.1:18789"
          >
        </div>

        <div>
          <label class="block text-sm text-[var(--text-secondary)] mb-1">Token</label>
          <div class="relative">
            <input
              v-model="token"
              :type="showToken ? 'text' : 'password'"
              class="settings-input pr-16"
              placeholder="Gateway auth token"
            >
            <button
              class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              @click="showToken = !showToken"
            >
              {{ showToken ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>

        <button
          class="connect-button"
          :class="{ disabled: !url || !token || props.connecting }"
          :disabled="!url || !token || props.connecting"
          @click="handleConnect"
        >
          {{ props.connecting ? 'Connecting...' : 'Connect' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-card {
  background: var(--surface-secondary);
  padding: 32px;
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  width: 400px;
  max-width: 90vw;
}

.settings-input {
  width: 100%;
  background: var(--surface-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-input);
  padding: 8px 16px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.settings-input:focus {
  border-color: var(--accent);
}

.connect-button {
  width: 100%;
  padding: 8px;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: var(--radius-button);
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
}
.connect-button:hover:not(:disabled) {
  background: var(--accent-hover);
}
.connect-button.disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
