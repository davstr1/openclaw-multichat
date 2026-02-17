import { ref } from 'vue'

export function useNotifications() {
  const permission = ref(Notification.permission)

  async function requestPermission() {
    if ('Notification' in window) {
      const result = await Notification.requestPermission()
      permission.value = result
    }
  }

  function notify(title: string, body: string, agentId?: string) {
    if (permission.value !== 'granted') return

    const notification = new Notification(title, {
      body,
      icon: '/openclaw-icon.png',
      tag: agentId || 'openclaw',
      silent: false,
    })

    notification.onclick = () => {
      window.focus()
      notification.close()
    }
  }

  return { permission, requestPermission, notify }
}
