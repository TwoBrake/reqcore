import { defineTask } from 'nitropack/runtime/task'
import { runNotificationDispatch } from '../utils/notifications/dispatch'

export default defineTask({
  meta: {
    name: 'notification-dispatch',
    description: 'Drain the recruiter notification outbox and send instant emails via Resend',
  },
  async run() {
    const result = await runNotificationDispatch({ source: 'scheduled_task' })
    return { result }
  },
})
