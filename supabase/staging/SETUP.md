# Staging — Owner Setup (dashboard steps)

Claude did the DB schema + `staging` git branch. These 3 steps need YOU in the
dashboards (Claude can't set dashboard config or OAuth secrets). ~15 minutes total.

Do them in order. After all 3, staging is live and isolated.

---

## STEP 1 — Vercel: point the `staging` branch at the staging DB

The `staging` branch is pushed; Vercel is already building a preview for it. Right now
it uses PROD's env vars (dangerous). Scope staging's own vars so the staging deploy
talks to the staging database instead.

1. Vercel dashboard → your **clubkeeper** project → **Settings** → **Environment Variables**.
2. Add TWO variables, and IMPORTANT — set their **Environment** to **Preview** and, if Vercel
   shows a branch filter, restrict to branch **`staging`** (so prod on `main` is untouched):

   | Key | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://tdcvrmttnsyhqxxhfvwj.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkY3ZybXR0bnN5aHF4eGhmdndqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDg0NzUsImV4cCI6MjEwMDQ4NDQ3NX0.AdBXAce_ofPgmf9cDLyX0dEgXys_LAE8zuiBAy4Yo70` |

3. Leave the existing `main`/Production values ALONE — those stay pointed at prod.
4. Vercel → **Deployments** → find the latest `staging` deployment → **Redeploy** so it
   picks up the new vars.
5. Note the staging URL (looks like `clubkeeper-git-staging-<you>.vercel.app`).

---

## STEP 2 — Staging Supabase: enable the JWT hook + Google login

The staging DB has the `add_user_meta_to_jwt` function, but the hook that CALLS it on every
login must be switched on in the dashboard. Without it, RLS sees no `user_club_id` and sync
appears dead.

**2a. Access-token hook**
1. Open the **staging** project: https://supabase.com/dashboard/project/tdcvrmttnsyhqxxhfvwj
2. **Authentication** → **Hooks** (under Configuration).
3. **Add hook** → type **Customize Access Token (JWT) Claims** → **Postgres** →
   schema `public`, function `add_user_meta_to_jwt` → Enable → Save.

**2b. Google OAuth** (staging needs its own, or logins fail)
1. Staging project → **Authentication** → **Providers** → **Google** → Enable.
2. Simplest for testing: you can reuse your existing Google OAuth client, BUT you must add
   the staging callback URL to it in Google Cloud Console:
   - Google Cloud Console → APIs & Services → Credentials → your OAuth client →
     Authorized redirect URIs → **add**: `https://tdcvrmttnsyhqxxhfvwj.supabase.co/auth/v1/callback`
   - Paste that client's ID + secret into staging's Google provider.
3. Staging project → **Authentication** → **URL Configuration** → set **Site URL** to the
   staging Vercel URL from Step 1.5, and add it to **Redirect URLs**.

---

## STEP 3 — Verify isolation (do this, it's the whole point)

1. Open the staging URL → sign in with Google.
   - A brand-new club is created in the STAGING db (empty — no Ball Bended data). ✅
   - If you see NO tables / empty home, that's CORRECT — staging starts empty.
2. Open the real app (`app.handbookhq.in`) → confirm Ball Bended data is still all there,
   completely unchanged. ✅
3. Create a junk table in staging (e.g. "TEST DELETE ME"). Confirm it does NOT appear in prod. ✅

If all three hold: staging is isolated and ready. From now on, risky changes go to `staging`
first, get verified, THEN merge to `main`.

---

## Keeping staging alive

Free-tier Supabase pauses after 7 days idle. The prod keep-alive Action only pings prod.
Either (a) touch staging manually now and then, or (b) tell Claude to add staging to the
keep-alive workflow. Not urgent — a paused staging just needs a dashboard "Restore" click.
