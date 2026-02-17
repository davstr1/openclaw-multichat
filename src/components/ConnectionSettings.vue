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
  localStorage.setItem('oc-gateway-url', url.value)
  localStorage.setItem('oc-gateway-token', token.value)
  emit('connect', url.value, token.value)
}
</script>

<template>
  <div class="connect-page">
    <div class="connect-card">
      <div class="card-header">
        <h1 class="title">OpenClaw</h1>
        <p class="subtitle">Connect to your gateway</p>
      </div>

      <!-- Error -->
      <div v-if="props.error" class="alert alert-error">
        {{ props.error }}
      </div>

      <div class="form">
        <div class="field">
          <label class="label">Gateway URL</label>
          <input
            v-model="url"
            type="text"
            class="input"
            placeholder="ws://127.0.0.1:18789"
          >
        </div>

        <div class="field">
          <label class="label">Token</label>
          <div class="input-wrap">
            <input
              v-model="token"
              :type="showToken ? 'text' : 'password'"
              class="input"
              placeholder="Gateway auth token"
              @keydown.enter="handleConnect"
            >
            <button class="toggle-vis" @click="showToken = !showToken">
              {{ showToken ? 'Hide' : 'Show' }}
            </button>
          </div>
        </div>

        <button
          class="btn-connect"
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
.connect-page {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--surface-primary);
}

.connect-card {
  width: 380px;
  max-width: 90vw;
  background: var(--surface-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-container);
  padding: 40px 32px 32px;
  box-shadow: var(--shadow-card);
}

.card-header {
  text-align: center;
  margin-bottom: 32px;
}
.title {
  font-size: 22px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.02em;
}
.subtitle {
  font-size: 14px;
  color: var(--text-muted);
  margin-top: 4px;
}

.alert {
  padding: 10px 16px;
  border-radius: var(--radius-md);
  font-size: 13px;
  margin-bottom: 24px;
}
.alert-error {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: var(--danger);
}

.form {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.input {
  width: 100%;
  background: var(--surface-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-input);
  padding: 10px 16px;
  font-size: 14px;
  outline: none;
  font-family: var(--font-sans);
  transition: border-color 0.2s;
}
.input:focus {
  border-color: var(--accent);
}
.input::placeholder {
  color: var(--text-muted);
}

.input-wrap {
  position: relative;
}
.input-wrap .input {
  padding-right: 56px;
}
.toggle-vis {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 12px;
  cursor: pointer;
  font-family: var(--font-sans);
  transition: color 0.15s;
}
.toggle-vis:hover {
  color: var(--text-secondary);
}

.btn-connect {
  width: 100%;
  padding: 12px;
  background: var(--accent);
  color: var(--accent-text);
  border: none;
  border-radius: var(--radius-button);
  font-weight: 600;
  font-size: 14px;
  font-family: var(--font-sans);
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  margin-top: 4px;
}
.btn-connect:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-connect:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
</style>
