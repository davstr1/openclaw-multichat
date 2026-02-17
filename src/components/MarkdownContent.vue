<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  content: string
}>()

// Configure marked for chat-friendly output
marked.setOptions({
  breaks: true,
  gfm: true,
})

// Auto-link bare URLs and file paths that markdown didn't catch
function autoLink(html: string): string {
  // Don't touch anything already inside an <a> tag or href attribute
  // Split by existing tags to only process text nodes
  const parts = html.split(/(<[^>]+>)/)
  let insideA = 0

  return parts.map((part) => {
    // Track <a> nesting
    if (part.match(/^<a[\s>]/i)) insideA++
    if (part.match(/^<\/a>/i)) insideA--

    // Skip if inside a tag or if this is a tag itself
    if (insideA > 0 || part.startsWith('<')) return part

    // Bare URLs (http/https) not already linked
    part = part.replace(
      /(?<!\w)(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    )

    // File paths: ~/... or /absolute/... — click to open in system
    // Strip trailing punctuation (.,;:!?) that's likely sentence-level
    part = part.replace(
      /(?<!\w)((?:~\/|\/(?:Users|home|tmp|var|etc|opt|usr)\/)[^\s<>"')\]]+[^\s<>"')\].,;:!?])/g,
      '<span class="file-path" title="Click to open" data-path="$1">$1</span>'
    )

    return part
  }).join('')
}

const container = ref<HTMLElement>()

function handleClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('file-path') && target.dataset.path) {
    const path = target.dataset.path
    target.classList.add('opening')
    fetch('/api/open-path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    })
      .then((res) => {
        if (res.ok) {
          target.classList.add('opened')
          setTimeout(() => target.classList.remove('opened', 'opening'), 1000)
        } else {
          target.classList.remove('opening')
          target.classList.add('error')
          setTimeout(() => target.classList.remove('error'), 1500)
        }
      })
      .catch(() => {
        target.classList.remove('opening')
      })
  }
}

onMounted(() => {
  container.value?.addEventListener('click', handleClick)
})
onUnmounted(() => {
  container.value?.removeEventListener('click', handleClick)
})

const html = computed(() => {
  if (!props.content) return ''
  const raw = marked.parse(props.content) as string
  // Ensure all markdown-generated links also open in new tab
  const withTargets = raw.replace(/<a href="/g, '<a target="_blank" rel="noopener noreferrer" href="')
  const linked = autoLink(withTargets)
  return DOMPurify.sanitize(linked, { ADD_ATTR: ['target', 'rel', 'data-path'] })
})
</script>

<template>
  <div ref="container" class="markdown-body" v-html="html" />
</template>

<style>
.markdown-body {
  font-size: 14px;
  line-height: 1.6;
  word-wrap: break-word;
}

.markdown-body p {
  margin: 0 0 8px;
}
.markdown-body p:last-child {
  margin-bottom: 0;
}

.markdown-body code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.markdown-body pre {
  background: rgba(0, 0, 0, 0.3);
  padding: 12px 16px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 8px 0;
}
.markdown-body pre code {
  background: none;
  padding: 0;
  font-size: 13px;
}

.markdown-body strong {
  font-weight: 600;
}

.markdown-body em {
  font-style: italic;
}

.markdown-body ul, .markdown-body ol {
  margin: 4px 0;
  padding-left: 20px;
}

.markdown-body li {
  margin: 2px 0;
}

.markdown-body a {
  color: var(--accent-hover);
  text-decoration: none;
}
.markdown-body a:hover {
  text-decoration: underline;
}

.markdown-body blockquote {
  border-left: 3px solid var(--border-strong);
  padding-left: 12px;
  margin: 8px 0;
  color: var(--text-secondary);
}

.markdown-body h1, .markdown-body h2, .markdown-body h3 {
  margin: 8px 0 4px;
  font-weight: 600;
}
.markdown-body h1 { font-size: 18px; }
.markdown-body h2 { font-size: 16px; }
.markdown-body h3 { font-size: 15px; }

.markdown-body hr {
  border: none;
  border-top: 1px solid var(--border-default);
  margin: 12px 0;
}

.markdown-body table {
  border-collapse: collapse;
  width: 100%;
  margin: 8px 0;
}
.markdown-body th, .markdown-body td {
  border: 1px solid var(--border-default);
  padding: 6px 10px;
  text-align: left;
  font-size: 13px;
}
.markdown-body th {
  background: rgba(255, 255, 255, 0.05);
  font-weight: 600;
}

.markdown-body .file-path {
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--accent-hover);
  cursor: pointer;
  transition: background 0.15s;
}
.markdown-body .file-path:hover {
  background: rgba(255, 255, 255, 0.12);
}
.markdown-body .file-path.opening {
  opacity: 0.6;
}
.markdown-body .file-path.opened {
  background: rgba(34, 197, 94, 0.15);
}
.markdown-body .file-path.opened::after {
  content: ' ✓';
  color: var(--success);
  font-size: 11px;
}
.markdown-body .file-path.error {
  background: rgba(239, 68, 68, 0.15);
}
.markdown-body .file-path.error::after {
  content: ' ✗';
  color: var(--danger);
  font-size: 11px;
}

/* User messages: lighter code blocks */
.message-bubble.user .markdown-body code {
  background: rgba(255, 255, 255, 0.15);
}
.message-bubble.user .markdown-body pre {
  background: rgba(0, 0, 0, 0.2);
}
</style>
