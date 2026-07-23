import type { MaybeRefOrGetter } from 'vue'
import type { ApplicationRuleInput } from '~~/shared/application-rules'

export interface ApplicationRule extends ApplicationRuleInput {
  id: string
  jobId: string
  displayOrder: number
}

/**
 * Composable for managing a job's application automation rules.
 * The builder edits a local draft and saves the whole set atomically (PUT).
 */
export function useApplicationRules(jobId: MaybeRefOrGetter<string>) {
  const { handlePreviewReadOnlyError } = usePreviewReadOnly()
  const id = computed(() => toValue(jobId))

  const { data, status, error, refresh } = useFetch(
    () => `/api/jobs/${id.value}/rules`,
    {
      key: computed(() => `job-rules-${id.value}`),
      headers: useRequestHeaders(['cookie']),
      default: () => ({ rules: [] as ApplicationRule[] }),
    },
  )

  const rules = computed(() => data.value?.rules ?? [])

  /** Replace the entire rule set for the job. */
  async function saveRules(payload: ApplicationRuleInput[]) {
    try {
      const res = await $fetch(`/api/jobs/${id.value}/rules`, {
        method: 'PUT',
        body: { rules: payload },
      })
      await refresh()
      return res
    } catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  /** Retroactively apply the saved rules to existing `new` applicants. */
  async function runRules() {
    try {
      return await $fetch(`/api/jobs/${id.value}/rules/run`, { method: 'POST' })
    } catch (err) {
      handlePreviewReadOnlyError(err)
      throw err
    }
  }

  return { rules, status, error, refresh, saveRules, runRules }
}
