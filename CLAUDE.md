# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PokéTracker (package name "TCG-Collector") — a Pokémon TCG collection/trading tracker, PT-BR UI, mobile-first React SPA. Two independent processes: **frontend** (repo root, React 19 + Vite) and **backend** (`server/`, Express). The frontend never talks to the Pokémon TCG API directly — it always goes through the Express backend, which holds the API key and proxies/caches catalog data. Auth, user data, friends, and trades live in Supabase (Postgres + Auth); the Express backend is the only thing with the Supabase **service role** key.

Deploy targets: frontend on Vercel (custom domain `tcgcolecionador.com.br`), backend on Render (`api.tcgcolecionador.com.br`, behind Cloudflare). Both auto-deploy from `main`. If Render can't reach GitHub after the repo goes private, its GitHub App needs re-authorizing at github.com/settings/installations.

## Commands

Frontend (repo root):
- `npm run dev` — Vite dev server on :3000, proxies `/api/*` to the backend (regex proxy in `vite.config.ts`, careful not to match the `api.ts` source file)
- `npm run build` — production build (also run before shipping to catch type/bundle issues)
- `npx tsc --noEmit` — typecheck

Backend (`server/`):
- `npm run dev` — `tsx watch src/index.ts` on :8787
- `npm run build` — `tsc -p tsconfig.json`
- `npm run codes:generate` / `codes:list` — manage premium access codes (trading is gated behind a redeemed code, see `middleware/auth.ts` below)
- `npm run premium:set` — `scripts/revoke-premium.js`

No automated test suite exists (frontend or backend). Verification is: `tsc --noEmit` + `npm run build` on both sides, plus manual/Playwright E2E against a live Supabase project when UI behavior needs confirming (see Testing below).

## Environment

Frontend `.env.local`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (safe to expose), optional `VITE_API_URL_PROXY_TARGET`.

Backend `server/.env`: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret — full DB access, bypasses RLS), `CLIENT_ORIGIN` (comma-separated list — needs both apex and `www` variants since Vercel redirects between them and CORS must match exactly), `POKEMONTCG_API_KEY`, `PORT`.

Supabase project ref: `ihaogdkyrsfiywqiuogs`. Service-role keys are now the new `sb_secret_...` format (not a JWT) — `@supabase/supabase-js`'s `admin.auth.admin.createUser()` currently breaks on this format ("unrecognized JWT kid"); use a raw `fetch` to `/auth/v1/admin/users` instead when scripting user creation. Plain `.from(...)` queries and `listUsers()` are unaffected.

## Backend architecture (`server/src`)

- `index.ts` — helmet, CORS (multi-origin allow-list from `env.clientOrigins`), `express.json({ limit: '10mb' })` (collections with many cards + full variation/condition/language matrices get large — this was raised once already, be wary of shrinking it), a blanket rate limiter, then routers mounted at `/api/tcg`, `/api/tcg-jp`, `/api/users`, `/api/friends`, `/api/trades`, `/api/premium`. The catch-all error handler flattens every error to a generic 500 — when debugging a mystery 500, check server logs directly, the client response won't tell you anything.
- `middleware/auth.ts` — `requireAuth` validates the `Authorization: Bearer <supabase access token>` via `supabase.auth.getUser(token)`. `requirePremium` gates trade features behind `premiumStore.isPremiumUser` (redeemed access code), since trading is in closed beta.
- `userStore.ts` — `assembleFullUser` / `replaceUserData` assemble and persist the whole `FullUser` shape (profile, owned cards, friends, folders, wishlist) in one PUT. `replaceUserData` **upserts + diffs against what's already in the DB** (never blind delete-then-insert) for `user_cards`, `wishlist`, `trade_folders`, `trade_folder_cards` — this matters because two overlapping saves for the same user (e.g. the client's trade-folder auto-sync firing alongside another edit) used to hit `23505` duplicate-key errors under the old delete/insert pattern. Diffing against the DB (not a giant `NOT IN` filter) also matters because real collections run 700+ cards.
- `tradeStore.ts` / `routes/trades.ts` — trade state machine (see below).
- `routes/tcg.ts` — proxies/caches the Pokémon TCG catalog (sets, cards, community price stats via `/card-stats/:cardId`). `fallbackData.ts` is a small hardcoded catalog used if the upstream API is unreachable.
- `routes/tcgJp.ts` — separate catalog source (TCGdex) for Japanese/Oriental collections, kept apart from the western pokemontcg.io-backed catalog.

## Frontend architecture

- `App.tsx` — owns the authenticated `User`, active tab, and the **save pipeline**: every mutation goes through `handleUpdateUser`, which updates React state optimistically and debounces (500ms) a `PUT /api/users/me` via `persistUser`. `flushPendingSave` bypasses the debounce and is called before any point the user might navigate away (tab change, logout, `beforeunload`/`visibilitychange`) so a fast reload can't silently drop a save. A save still in flight blocks tab changes with a "Salvando..." overlay; F5/Ctrl+R while saving is intercepted to show a custom confirm dialog (the native `beforeunload` prompt's text can't be customized).
- `db.ts` — the card/variation data model helpers. Each owned card's `variations` is a sparse map that `getNormalizedVariations` expands to the full cross-product of `VARIATION_TYPES` (Standard/Foil/Reverse Foil/etc., see `types.ts`) × `CardCondition` (D/HP/MP/SP/NM) × optional per-language sub-entries (`ConditionDetails.languages`). **The aggregate `price`/`quantity` fields and the per-language ones are updated independently** (`setLanguagePrice` only touches the language entry) — code that reads price/quantity must check `languages` first or it'll silently miss data (this has caused real bugs: backfilled prices invisible in the UI, community stats excluding language-broken-down cards).
- `viewMode.ts` + `components/CardViewModeSelector.tsx` + `components/CardItem.tsx` — the shared list/grid-3/grid-6 view toggle (`CardViewMode`) used across Home, Collection, and every trade-folder view (own folders, wishlist, friend's folders). Grid-6 is desktop-only (`md:` breakpoint, 768px — the only responsive breakpoint convention in the app; most of the UI is otherwise mobile-only with no responsive variants, so don't assume a component adapts to desktop unless you check).
- `views/TradesView.tsx` + `components/FriendFolderBrowser.tsx` — trade folder browsing/management. `trade_folders.id` is a **global** primary key (not scoped per user), so folder ids are constructed as `` `${userId}-...` `` (see `defaultFolderId`) to avoid cross-account collisions — never go back to a bare literal id like `'default'`. Friend-folder card ordering always prioritizes wishlist > not-yet-owned > everything else (`getCardPriority`); preserve this when touching the render path.
- `components/TradeActionModal.tsx` + `trades.ts` — trade status state machine: `pending_response` → (`choose_payment` → `awaiting_payment_confirmation`, both sides `confirm`) or (`choose_offer` → `selecting_offer` → `awaiting_value_diff_confirmation`) → `completed`/`cancelled`. Choosing cash payment auto-confirms that side (no separate confirm click); only the card-for-card path has an explicit `submitTradeOffer` step.
- Styling: Tailwind is loaded via the **CDN script** in `index.html` (no build step, no `tailwind.config`) — this only works where the browser can reach `cdn.tailwindcss.com`; sandboxed/proxied environments need the requests routed through a local relay or Playwright route interception (see Testing).

## Testing / running locally against real data

There's no seed/local DB — everything hits the real Supabase project. The established pattern for browser-based (Playwright) testing in a sandboxed environment that can't complete TLS handshakes to external hosts directly:
- A tiny local HTTP→HTTPS relay (Node `fetch`, which *can* reach the outbound proxy) forwards `localhost:9999` → the real Supabase URL; `.env.local` is temporarily repointed at it, **always backed up first and restored after**.
- External CDNs (Tailwind, Google Fonts, card images from `images.pokemontcg.io`/`images.scrydex.com`) need the same treatment — either a relay or `context.route()` interception in Playwright — or the UI renders unstyled/broken in recordings/screenshots.
- Disposable test accounts only, pattern `sergioriman+e2<label><timestamp>@gmail.com`, created/deleted via the Supabase admin API, always cleaned up at the end of a test run.
- **Never touch these real accounts**: `sergioriman@gmail.com` (the project owner), `darkangelsergio@hotmail.com`, `samir.rimandias@gmail.com`.
- The trade-folder auto-sync (`TradesView.tsx`) only creates a friend's `trade_folders` row on the *client*, the first time that account visits the Trocas tab — a friend's folder won't be visible to test against until that account has logged in once and opened Trocas.

## Git workflow

Work happens on `claude/project-handoff-reading-97hut5`, PR'd into `main`. Since that branch gets merged and deleted-in-spirit each round, always restart it from `origin/main` before starting new work if the previous PR already merged (`git fetch origin main && git checkout -B claude/project-handoff-reading-97hut5 origin/main`), rather than stacking on already-merged history.
