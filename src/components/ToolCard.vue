<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ToolCall } from '../types'

const props = defineProps<{
  tool: ToolCall
}>()

const expanded = ref(false)

const statusLabel = computed(() => {
  if (props.tool.phase === 'start') return 'running'
  if (props.tool.phase === 'update') return 'running'
  return 'done'
})

const isRunning = computed(() => props.tool.phase !== 'result')

const displayName = computed(() => {
  const name = props.tool.name
  // Friendly labels for common tools
  const labels: Record<string, string> = {
    Read: 'Read file',
    Edit: 'Edit file',
    Write: 'Write file',
    exec: 'Run command',
    web_search: 'Web search',
    web_fetch: 'Fetch URL',
    browser: 'Browser',
    memory_search: 'Memory search',
    memory_get: 'Memory read',
    image: 'Analyze image',
    message: 'Send message',
    cron: 'Cron job',
    tts: 'Text to speech',
  }
  return labels[name] || name
})

const summary = computed(() => {
  const args = props.tool.args as Record<string, unknown> | undefined
  if (!args) return ''
  const name = props.tool.name

  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return (args.file_path || args.path || '') as string
  }
  if (name === 'exec') {
    return (args.command || '') as string
  }
  if (name === 'web_search') {
    return (args.query || '') as string
  }
  if (name === 'web_fetch') {
    return (args.url || '') as string
  }
  if (name === 'memory_search') {
    return (args.query || '') as string
  }

  // Generic: show first string arg
  for (const v of Object.values(args)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 80)
  }
  return ''
})

const truncatedOutput = computed(() => {
  if (!props.tool.output) return ''
  const text = typeof props.tool.output === 'string' ? props.tool.output : JSON.stringify(props.tool.output, null, 2)
  if (text.length <= 300 || expanded.value) return text
  return text.slice(0, 300) + '...'
})

const hasOutput = computed(() => !!props.tool.output)
const isLong = computed(() => {
  if (!props.tool.output) return false
  const text = typeof props.tool.output === 'string' ? props.tool.output : JSON.stringify(props.tool.output)
  return text.length > 300
})
</script>

<template>
  <div class="tool-card" :class="{ running: isRunning }">
    <div class="tool-header" @click="hasOutput ? expanded = !expanded : null">
      <div class="tool-icon">
        <svg v-if="isRunning" class="spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <span class="tool-name">{{ displayName }}</span>
      <span v-if="summary" class="tool-summary">{{ summary }}</span>
      <span v-if="hasOutput" class="tool-expand">{{ expanded ? 'hide' : 'show' }}</span>
    </div>
    <div v-if="expanded && hasOutput" class="tool-output">
      <pre>{{ truncatedOutput }}</pre>
      <button v-if="isLong && !expanded" class="expand-btn" @click.stop="expanded = true">Show full output</button>
    </div>
  </div>
</template>

<style scoped>
.tool-card {
  margin: 4px 0;
  padding: 8px 12px;
  background: var(--surface-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 12px;
  max-width: 600px;
  transition: border-color 0.2s;
}
.tool-card.running {
  border-color: rgba(99, 102, 241, 0.3);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.tool-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}
.tool-card.running .tool-icon {
  color: var(--accent);
}

.spinner {
  animation: spin 1.2s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.tool-name {
  font-weight: 600;
  color: var(--text-secondary);
  white-space: nowrap;
}

.tool-summary {
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 11px;
}

.tool-expand {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--text-muted);
  font-size: 11px;
  opacity: 0;
  transition: opacity 0.15s;
}
.tool-header:hover .tool-expand {
  opacity: 1;
}

.tool-output {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-subtle);
}
.tool-output pre {
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.expand-btn {
  margin-top: 4px;
  background: none;
  border: none;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
  font-family: var(--font-sans);
  padding: 0;
}
.expand-btn:hover {
  text-decoration: underline;
}
</style>
