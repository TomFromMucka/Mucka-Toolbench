import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { AgentStatus, Job, JobId, JobStatusEvent } from '@shared/types'

interface JobsValue {
  jobs: Job[]
  /** What the job's Claude last reported. Idle until it reports anything. */
  jobStatusFor: (id: JobId) => AgentStatus
  /** Start a job. Resolves with it in `setting-up`, or throws why it couldn't start. */
  createJob: () => Promise<Job>
}

const Ctx = createContext<JobsValue | null>(null)

export function JobsProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [jobs, setJobs] = useState<Job[]>([])
  const [statuses, setStatuses] = useState<Partial<Record<JobId, AgentStatus>>>({})

  useEffect(() => {
    const api = window.mucka
    if (!api) return
    return api.onJobStatus((event: JobStatusEvent) =>
      setStatuses((prev) =>
        prev[event.jobId] === event.status ? prev : { ...prev, [event.jobId]: event.status }
      )
    )
  }, [])

  const jobStatusFor = useCallback((id: JobId): AgentStatus => statuses[id] ?? 'idle', [statuses])

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

  const value = useMemo<JobsValue>(
    () => ({ jobs, jobStatusFor, createJob }),
    [jobs, jobStatusFor, createJob]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useJobs(): JobsValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useJobs must be used inside JobsProvider')
  return ctx
}
