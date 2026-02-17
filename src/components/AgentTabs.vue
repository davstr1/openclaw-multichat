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
  <nav class="tabs-bar">
    <button
      v-for="agent in props.agents"
      :key="agent.id"
      class="tab"
      :class="{ active: agent.id === props.activeAgentId }"
      @click="emit('select', agent.id)"
    >
      <span class="tab-name">{{ agent.name }}</span>
      <span
        v-if="(unreadCounts[agent.id] || 0) > 0"
        class="badge"
      >
        {{ unreadCounts[agent.id] }}
      </span>
    </button>
  </nav>
</template>

<style scoped>
.tabs-bar {
  display: flex;
  gap: 4px;
  padding: 8px 24px;
  justify-content: center;
  background: var(--surface-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: var(--font-sans);
  letter-spacing: 0.01em;
  transition: color 0.2s, background 0.2s;
}

.tab:hover {
  color: var(--text-secondary);
  background: var(--surface-secondary);
}

.tab.active {
  color: var(--text-primary);
  background: var(--surface-tertiary);
}

.tab.active::after {
  content: '';
  position: absolute;
  bottom: -9px;
  left: 50%;
  transform: translateX(-50%);
  width: 16px;
  height: 2px;
  background: var(--accent);
  border-radius: var(--radius-pill);
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
</style>
