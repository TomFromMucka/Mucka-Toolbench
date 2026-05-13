import { muckaBannerStatus } from '../data/mockMucka'

interface MuckaTopBannerProps {
  onOpenSettings: () => void
}

export function MuckaTopBanner({
  onOpenSettings
}: MuckaTopBannerProps): React.JSX.Element {
  return (
    <header className="relative flex items-center gap-4 bg-mucka px-5 py-2 text-paper-cream shadow-[0_3px_10px_rgba(0,0,0,0.45)]">
      {/* Mucka mark */}
      <div className="flex shrink-0 items-center gap-2">
        <span
          className="grid size-7 place-items-center rounded-full bg-paper-cream font-[var(--font-display)] text-[1.05rem] font-bold leading-none text-mucka shadow-inner"
          aria-hidden
        >
          M
        </span>
        <span className="font-[var(--font-display)] text-[1.4rem] font-bold leading-none tracking-wide">
          Mucka
        </span>
        <span className="text-paper-cream/75 text-[0.7rem] uppercase tracking-[0.18em]">
          Workstation
        </span>
      </div>

      {/* PM status line */}
      <div className="min-w-0 flex-1">
        <p className="truncate font-[var(--font-hand)] text-[1rem] leading-tight">
          <span className="opacity-75">PM:</span>{' '}
          <span className="font-semibold">{muckaBannerStatus}</span>
        </p>
      </div>

      {/* Right-side glance + settings */}
      <div className="hidden shrink-0 items-center gap-4 text-[0.8rem] uppercase tracking-[0.14em] text-paper-cream/85 md:flex">
        <span>4 worktrees</span>
        <span>·</span>
        <span>1 needs you</span>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        title="Settings (⌘,)"
        aria-label="Open settings"
        className="ml-1 grid size-8 shrink-0 place-items-center rounded-full border border-paper-cream/30 bg-mucka-deep/40 text-paper-cream hover:bg-mucka-deep/70"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>
    </header>
  )
}
