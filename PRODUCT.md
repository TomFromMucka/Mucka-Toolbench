# Product context

> Source of truth for what you're building, who it's for, and what good
> looks like. Mucka (the PM agent) reads this on demand via
> `get_product_doc` so she can spot when a PR drifts from brand, suggest
> sensible roadmap priorities, or push back on an idea that doesn't fit.
>
> **This file is a public scaffold.** Fill it in — but to keep your
> product context private, place your filled-in copy at
> `~/.mucka-toolbench/PRODUCT.md` instead. The cockpit reads the
> override first and falls back to this scaffold. That way your
> roadmap, brand strategy, and quality bar live outside the repo
> (useful if you've forked the toolbench publicly).
>
> Terse > thorough — Mucka pulls the whole doc on any substantive
> question, so concise framing beats long-form vision statements.

## Mission

_What is the product? In two or three sentences — what it does, who it
serves, why it exists. Include the one-line value prop you'd put at the
top of the homepage._

- 

## Audience

_Who's the primary user, and the secondary one? What's a day in their
life that this product slots into? Where do they meet it — app store,
web, referral, marketplace? What do they care about that competitors
miss?_

- 

## Brand & voice

_How the product talks and looks. Be specific._

- **Voice.** (e.g. dry, direct, no corporate fluff. Confident but
  never patronising.)
- **Visual language.** (colour reserves, typography, component
  silhouettes, motion — anything Mucka should check in a PR review)
- **What the product is NOT.** (lines you won't cross — tone, dark
  patterns, features that conflict with the mission)

## Current focus

_What's actively being built right now and why. The 1-3 things that
matter this month. Anything frozen / on hold._

- 

## Stack snapshot

_So Mucka can make sense of PR diffs without guessing._

- **Mobile:** 
- **Web:** 
- **Backend / data:** 
- **AI / integrations:** 
- **Infra / hosting:** 

## Quality bar

_What good looks like in a PR / a feature / a release. The things you'd
catch in review that aren't obvious from the code alone._

- **Code review red flags.** (e.g. magic numbers, new colour hexes
  instead of brand tokens, components that bypass the design-system
  primitives, untyped `any`, dead branches, half-finished implementations)
- **Definition of done.** (e.g. ships behind a flag if user-facing,
  has at least one happy-path test, no console errors in dev, screenshot
  attached to the PR for any UI change)
- **Performance / accessibility floors.** (e.g. Lighthouse mobile ≥ 90,
  Reduce Motion respected, keyboard-only path works)

## Repos & worktrees

_Where each project lives so Mucka can map an agent to a product surface._

| Agent | Project | Repo / worktree path |
| --- | --- | --- |
| Dave |  |  |
| Sammy |  |  |
| Kev |  |  |
| Bren |  |  |

## Glossary

_Domain terms that come up in conversation — so Mucka uses them the same
way you do. Keep short._

- 
