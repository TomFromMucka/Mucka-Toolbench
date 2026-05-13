import { muckaBannerStatus } from '../data/mockMucka'

export function MuckaTopBanner(): React.JSX.Element {
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

      {/* Right-side glance: clock + worktree count */}
      <div className="hidden shrink-0 items-center gap-4 text-[0.8rem] uppercase tracking-[0.14em] text-paper-cream/85 md:flex">
        <span>4 worktrees</span>
        <span>·</span>
        <span>1 needs you</span>
      </div>
    </header>
  )
}
