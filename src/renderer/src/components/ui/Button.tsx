import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'
import { cn } from './cn'

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'tertiary' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'
export type ButtonTone = 'default' | 'orange' | 'danger' | 'grey'

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  iconOnly?: boolean
  leadingIcon?: LucideIcon
  /** Renders text inside the leading chip instead of an icon. Takes priority over leadingIcon. */
  chipText?: string
  /** Renders a custom image inside the leading chip (e.g. brand mark).
   *  Takes priority over chipText and leadingIcon. */
  chipImageSrc?: string
  /** alt text for chipImageSrc. Defaults to empty (decorative). */
  chipImageAlt?: string
  /** Pass `null` to suppress the auto-arrow on primary buttons. */
  trailingIcon?: LucideIcon | null
  /** Colour treatment for tertiary buttons (and any future toned variants). */
  tone?: ButtonTone
  children?: ReactNode
}

const ICON_SIZE: Record<ButtonSize, { lead: number; trail: number; only: number }> = {
  lg: { lead: 16, trail: 18, only: 20 },
  md: { lead: 14, trail: 16, only: 18 },
  sm: { lead: 12, trail: 14, only: 16 }
}

/**
 * Mucka Pro design-system button. Five variants × three sizes ×
 * optional tones. Primary auto-adds a trailing ArrowRight unless
 * `trailingIcon={null}`. See `mucka-btn*` rules in styles/index.css
 * for the silhouette + chip + V-notch geometry.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'lg',
    fullWidth = false,
    iconOnly = false,
    leadingIcon,
    chipText,
    chipImageSrc,
    chipImageAlt = '',
    trailingIcon,
    tone = 'default',
    children,
    className,
    onClick,
    type = 'button',
    disabled,
    ...rest
  },
  ref
) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    onClick?.(e)
  }

  const sizes = ICON_SIZE[size]

  const resolvedTrailing: LucideIcon | null =
    trailingIcon === null
      ? null
      : trailingIcon ?? (variant === 'primary' && !iconOnly ? ArrowRight : null)

  const hasLeading = !!leadingIcon || !!chipText || !!chipImageSrc
  const showChip = variant === 'primary' && !iconOnly && hasLeading
  const showLeadNotch = variant === 'secondary' && !iconOnly && hasLeading

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      onClick={handleClick}
      className={cn(
        'mucka-btn',
        `mucka-btn-${variant}`,
        `mucka-btn-${size}`,
        tone !== 'default' && `mucka-btn-tone-${tone}`,
        fullWidth && 'mucka-btn-fullwidth',
        iconOnly && 'mucka-btn-icononly',
        showChip && 'mucka-btn-with-chip',
        showLeadNotch && 'mucka-btn-with-lead-notch',
        variant === 'primary' && !iconOnly && resolvedTrailing && 'mucka-btn-with-trail-notch',
        className
      )}
      {...rest}
    >
      {iconOnly ? (
        leadingIcon ? (
          <Icon icon={leadingIcon} size={sizes.only} />
        ) : null
      ) : (
        <>
          {hasLeading &&
            (variant === 'primary' ? (
              <span className="mucka-btn-chip">
                {chipImageSrc ? (
                  <img
                    src={chipImageSrc}
                    alt={chipImageAlt}
                    className="mucka-btn-chip-image"
                  />
                ) : chipText ? (
                  <span className="mucka-btn-chip-text">{chipText}</span>
                ) : leadingIcon ? (
                  <Icon icon={leadingIcon} size={sizes.lead} />
                ) : null}
              </span>
            ) : chipImageSrc ? (
              <img
                src={chipImageSrc}
                alt={chipImageAlt}
                className="mucka-btn-chip-image"
              />
            ) : chipText ? (
              <span className="mucka-btn-chip-text">{chipText}</span>
            ) : leadingIcon ? (
              <Icon icon={leadingIcon} size={sizes.lead} />
            ) : null)}
          <span className="mucka-btn-label">{children}</span>
          {resolvedTrailing && (
            <Icon
              icon={resolvedTrailing}
              size={sizes.trail}
              className="mucka-btn-trail"
            />
          )}
        </>
      )}
    </button>
  )
})
