import type { RoadmapBuildStatus, RoadmapCard } from '@shared/types'

/** Proposed by the oversight agent and not yet scored by anyone: the app badges these New. */
export function isNewTheme(card: RoadmapCard): boolean {
  return card.origin === 'oversight' && card.marketability === null
}

export const BUILD_STATUS_LABEL: Record<RoadmapBuildStatus, string> = {
  not_built: 'Not built',
  partial: 'Partly built',
  in_progress: 'Being built',
  built: 'Built'
}
