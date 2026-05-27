import useSWR from 'swr'
import { getSession } from '@/lib/api'
import type { SessionState } from '@/lib/types'

export function useSession(id: string | null, opts: { enabled?: boolean } = {}) {
  const enabled = opts.enabled ?? true
  const { data, error, isLoading, mutate } = useSWR<SessionState>(
    id && enabled ? `/session/${id}` : null,
    () => getSession(id!),
    {
      // Stop polling once the workflow is COMPLETE. Querying a closed Temporal
      // workflow forces a full-history replay on the worker; a 2s poll that never
      // stops saturates its gRPC connection. Completed state is terminal, so one
      // fetch is enough (revalidateOnFocus still refreshes on tab return).
      refreshInterval: (latest?: SessionState) => (latest?.stage === 'COMPLETE' ? 0 : 2000),
      refreshWhenHidden: false,
      revalidateOnFocus: true,
    }
  )
  return { session: data, error, isLoading, refresh: mutate }
}
