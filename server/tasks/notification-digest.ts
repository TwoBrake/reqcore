import { defineTask } from 'nitropack/runtime/task'
import { runNotificationDigest } from '../utils/notifications/dispatch'

export default defineTask({
  meta: {
    name: 'notification-digest',
    description: 'Group pending digest-cadence notifications into one daily summary email per recipient',
  },
  async run() {
    const result = await runNotificationDigest({ source: 'scheduled_task' })
    return { result }
  },
})
