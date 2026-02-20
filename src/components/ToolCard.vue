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

const toolMeta = computed(() => {
  const name = props.tool.name
  const meta: Record<string, { label: string; icon: string; color?: string }> = {
    Read: { label: 'Read file', icon: '📂' },
    Edit: { label: 'Edit file', icon: '✏️' },
    Write: { label: 'Write file', icon: '📝' },
    exec: { label: 'Run command', icon: '⚡' },
    web_search: { label: 'Web search', icon: '🔍' },
    web_fetch: { label: 'Fetch URL', icon: '🌐' },
    browser: { label: 'Browser', icon: '🖥️' },
    memory_search: { label: 'Memory search', icon: '🧠' },
    memory_get: { label: 'Memory read', icon: '🧠' },
    image: { label: 'Analyze image', icon: '🖼️' },
    message: { label: 'Send message', icon: '💬' },
    cron: { label: 'Cron job', icon: '⏰' },
    tts: { label: 'Text to speech', icon: '🔊' },
    sessions_spawn: { label: 'Spawn sub-agent', icon: '🤖', color: 'orange' },
    sessions_send: { label: 'Message sub-agent', icon: '🤖', color: 'orange' },
    sessions_list: { label: 'List sessions', icon: '📋' },
    sessions_history: { label: 'Session history', icon: '📜' },
    subagents: { label: 'Sub-agents', icon: '🤖', color: 'orange' },
    session_status: { label: 'Session status', icon: '📊' },
    canvas: { label: 'Canvas', icon: '🎨' },
    nodes: { label: 'Node control', icon: '📱' },
    agents_list: { label: 'List agents', icon: '👥' },
  }
  return meta[name] || { label: name, icon: '⚙️' }
})

const displayName = computed(() => toolMeta.value.label)
const toolIcon = computed(() => toolMeta.value.icon)
const toolColor = computed(() => toolMeta.value.color || '')

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
  if (name === 'sessions_spawn') {
    return (args.task || args.label || '') as string
  }
  if (name === 'sessions_send') {
    return ((args.message || '') as string).slice(0, 80)
  }
  if (name === 'message') {
    return ((args.message || '') as string).slice(0, 80)
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
  <div class="tool-card" :class="{ running: isRunning, [toolColor]: !!toolColor }">
    <div class="tool-header" @click="hasOutput ? expanded = !expanded : null">
      <span class="tool-emoji">{{ toolIcon }}</span>
      <div class="tool-status-icon">
        <svg v-if="isRunning" class="spinner" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
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
.tool-card.orange {
  border-color: rgba(245, 158, 11, 0.25);
  background: rgba(245, 158, 11, 0.05);
}
.tool-card.orange.running {
  border-color: rgba(245, 158, 11, 0.4);
}

.tool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.tool-emoji {
  flex-shrink: 0;
  font-size: 14px;
  line-height: 1;
}

.tool-status-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}
.tool-card.running .tool-status-icon {
  color: var(--accent);
}
.tool-card.orange.running .tool-status-icon {
  color: rgb(245, 158, 11);
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
