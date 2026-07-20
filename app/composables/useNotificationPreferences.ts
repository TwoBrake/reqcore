import type { NotificationChannelMode, NotificationType } from '~~/shared/notifications'

export interface NotificationPreference {
  type: NotificationType
  channelMode: NotificationChannelMode
}

/**
 * Composable for reading and updating the current user's recruiter notification
 * preferences for the active organization.
 */
export async function useNotificationPreferences() {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()

  const { data: preferences, status, error, refresh } = await useFetch<NotificationPreference[]>(
    '/api/notification-preferences',
    {
      key: 'notification-preferences',
      headers: useRequestHeaders(['cookie']),
      default: () => [],
    },
  )

  async function updatePreferences(updates: NotificationPreference[]) {
    try {
      const updated = await $fetch<NotificationPreference[]>('/api/notification-preferences', {
        method: 'PATCH',
        body: { preferences: updates },
      })
      preferences.value = updated
      return updated
    }
    catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  return { preferences, status, error, refresh, updatePreferences }
}
