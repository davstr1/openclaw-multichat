<script setup lang="ts">
import type { Agent } from '../types'

const props = defineProps<{
  agents: Agent[]
  activeAgentId: string
  unreadCounts: Record<string, number>
}>()

const emit = defineEmits<{
  (e: 'select', agentId: string): void
}>()
</script>

<template>
  <div class="flex gap-1 px-4 py-2 bg-[var(--surface-secondary)] border-b border-[var(--border-default)]">
    <button
      v-for="agent in props.agents"
      :key="agent.id"
      class="tab-button"
      :class="{ active: agent.id === props.activeAgentId }"
      @click="emit('select', agent.id)"
    >
      <span v-if="agent.label" class="mr-1 text-xs font-mono opacity-60">{{ agent.label }}</span>
      <span>{{ agent.name }}</span>
      <span
        v-if="(unreadCounts[agent.id] || 0) > 0"
        class="ml-2 px-1.5 py-0.5 text-xs rounded-full bg-[var(--accent)] text-[var(--accent-text)]"
      >
        {{ unreadCounts[agent.id] }}
      </span>
    </button>
  </div>
</template>

<style scoped>
.tab-button {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-radius: var(--radius-button);
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.15s ease;
}

.tab-button:hover {
  background: var(--surface-tertiary);
  color: var(--text-primary);
}

.tab-button.active {
  background: var(--surface-tertiary);
  color: var(--text-primary);
  border-color: var(--border-strong);
}
</style>
