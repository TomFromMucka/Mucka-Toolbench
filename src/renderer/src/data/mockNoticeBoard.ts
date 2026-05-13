import type { NoticeBoardItem } from '@shared/types'

export const mockNoticeBoard: NoticeBoardItem[] = [
  {
    id: 'n1',
    title: 'Friday merge freeze',
    body: 'No non-critical merges after 4pm Thu. Mobile cut on Fri AM.',
    pinned: true,
    colour: 'yellow'
  },
  {
    id: 'n2',
    title: 'Conventions reminder',
    body: 'Prompts live in src/lib/elevenlabs/prompts/*.md — sync, do not edit dash.',
    colour: 'cream'
  },
  {
    id: 'n3',
    title: 'Ask Maya re: charts',
    body: 'Confirm colour palette before Bren commits chart styling.',
    colour: 'pink'
  },
  {
    id: 'n4',
    title: 'Coffee',
    body: '☕ Bean refill on the counter. Don’t @ me.',
    colour: 'blue'
  }
]
