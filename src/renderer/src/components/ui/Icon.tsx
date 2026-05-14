import type { LucideIcon, LucideProps } from 'lucide-react'

export interface IconProps extends LucideProps {
  icon: LucideIcon
}

/**
 * Thin wrapper around Lucide icons with the Mucka defaults baked in
 * (size 24, strokeWidth 2.25, currentColor). Lucide is the only icon
 * source — don't add custom SVG sprites.
 */
export function Icon({
  icon: I,
  size = 24,
  strokeWidth = 2.25,
  ...rest
}: IconProps): React.JSX.Element {
  return <I size={size} strokeWidth={strokeWidth} {...rest} />
}
