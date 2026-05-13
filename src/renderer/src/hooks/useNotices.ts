import { useCallback, useEffect, useState } from 'react'
import type { Notice, NoticeInput } from '@shared/types'

interface UseNoticesResult {
  notices: Notice[]
  loading: boolean
  reload: () => Promise<void>
  add: (input: NoticeInput) => Promise<Notice>
  remove: (id: string) => Promise<boolean>
  removeByTitle: (title: string) => Promise<number>
}

export function useNotices(): UseNoticesResult {
  const [notices, setNotices] = useState<Notice[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    const list = await window.mucka.listNotices()
    setNotices(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const add = useCallback(
    async (input: NoticeInput) => {
      const created = await window.mucka.addNotice(input)
      await reload()
      return created
    },
    [reload]
  )

  const remove = useCallback(
    async (id: string) => {
      const ok = await window.mucka.removeNotice(id)
      if (ok) await reload()
      return ok
    },
    [reload]
  )

  const removeByTitle = useCallback(
    async (title: string) => {
      const n = await window.mucka.removeNoticeByTitle(title)
      if (n > 0) await reload()
      return n
    },
    [reload]
  )

  return { notices, loading, reload, add, remove, removeByTitle }
}
