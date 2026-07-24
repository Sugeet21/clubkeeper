# ClubKeeper Staging Environment

A full-isolation staging environment so changes get verified OFF the owner's live app.
Built 24 Jul 2026 (the "never test on live again" fix after the demo).

## What's isolated

| Layer | Production | Staging |
|---|---|---|
| Git branch | `main` | `staging` |
| Deploy URL | `app.handbookhq.in` | Vercel preview for `staging` branch |
| Supabase project | `clubkeeper` (`vkczmgzujpidbwtzulel`) | `clubkeeper-staging` (`tdcvrmttnsyhqxxhfvwj`) |
| Data | REAL club data (Ball Bended etc.) | throwaway, starts empty |

**Staging can NEVER touch production data** — different Supabase project entirely.

## Workflow

1. Build/test a change on the `staging` branch → auto-deploys to the staging URL wired to the staging DB.
2. Verify the real flow there (create staff, add stock, sessions, close day).
3. Only once it passes: `git checkout main && git merge staging && git push` → live.

## Staging Supabase connection

- URL: `https://tdcvrmttnsyhqxxhfvwj.supabase.co`
- anon key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkY3ZybXR0bnN5aHF4eGhmdndqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDg0NzUsImV4cCI6MjEwMDQ4NDQ3NX0.AdBXAce_ofPgmf9cDLyX0dEgXys_LAE8zuiBAy4Yo70`

## Schema

`staging_core_schema.sql` is the CORE-SYNC clone applied to staging (12 tables, RLS, LWW +
actor-stamp triggers, JWT hook, auth trigger, realtime). Extracted verbatim from prod.
SKIPPED for now (add on demand): booking_intents, bookings, topup_intents + their RPCs.

## ⚠️ Manual dashboard steps — ONLY the owner can do these (see SETUP.md)

The DB schema + git branch are done by Claude. Three things need the owner in the dashboards:
1. Vercel: scope staging env vars to the `staging` branch.
2. Supabase (staging): enable the JWT access-token hook + Google OAuth.
3. Verify isolation.

Full click-by-click in `SETUP.md`.
