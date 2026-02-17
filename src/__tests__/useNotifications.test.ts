import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useNotifications } from '../composables/useNotifications'

describe('useNotifications', () => {
  beforeEach(() => {
    // Mock Notification API
    const mockNotification = vi.fn()
    mockNotification.prototype.close = vi.fn()
    Object.defineProperty(mockNotification, 'permission', {
      get: () => 'granted',
      configurable: true,
    })
    mockNotification.requestPermission = vi.fn().mockResolvedValue('granted')
    vi.stubGlobal('Notification', mockNotification)
  })

  it('should initialize with current permission', () => {
    const { permission } = useNotifications()
    expect(permission.value).toBe('granted')
  })

  it('should request permission', async () => {
    const { requestPermission, permission } = useNotifications()
    await requestPermission()
    expect(permission.value).toBe('granted')
  })

  it('should create notification when granted', () => {
    const { notify } = useNotifications()
    notify('Test', 'Body', 'agent-1')
    expect(Notification).toHaveBeenCalledWith('Test', expect.objectContaining({
      body: 'Body',
      tag: 'agent-1',
    }))
  })
})
