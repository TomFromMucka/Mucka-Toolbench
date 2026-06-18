/** Shared panel-sizing primitives for column stacks (agents + middle column). */

/** Discrete panel height a column stack can drive. */
export type PanelSize = 'min' | 'mid' | 'max'

/** Props a column-stacked panel accepts so its parent can drive height. */
export interface PanelSizeProps {
  size?: PanelSize
  onResize?: (size: PanelSize) => void
}

/** grid-template-rows track for a given size. Siblings reflow against
 *  each other: 'min' is header-only, 'mid' a single weight, 'max' a
 *  heavier weight so it dominates without crushing the others. */
export function rowForSize(size: PanelSize): string {
  if (size === 'min') return 'auto'
  if (size === 'max') return 'minmax(0, 2.5fr)'
  return 'minmax(0, 1fr)'
}
