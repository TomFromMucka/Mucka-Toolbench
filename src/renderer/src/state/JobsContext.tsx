import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { Job } from '@shared/types'

interface JobsValue {
  jobs: Job[]
  /** Start a job. Resolves with it in `setting-up`, or throws why it couldn't start. */
  createJob: () => Promise<Job>
}

const Ctx = createContext<JobsValue | null>(null)

export function JobsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    let alive = true
    void api.listJobs().then((list) => {
      if (alive) setJobs(list)
    })
    const off = api.onJobsUpdate((list) => setJobs(list))
    return () => {
      alive = false
      off()
    }
  }, [])

  const createJob = useCallback(async (): Promise<Job> => {
    const job = await window.mucka.createJob()
    setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [...prev, job]))
    return job
  }, [])

  const value = useMemo<JobsValue>(() => ({ jobs, createJob }), [jobs, createJob])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useJobs(): JobsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useJobs must be used inside JobsProvider')
  return ctx
}
