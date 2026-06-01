# Deployment

## Current Setup

- **Code repo:** `github.com/Sugeet21/clubkeeper`
- **Live URL (primary):** `app.handbookhq.in` (custom domain on Vercel)
- **Live URL (backup):** `clubkeeper.vercel.app` (Vercel-assigned subdomain, still active)
- **Hosting:** Vercel free tier
- **Branch:** `main` is production. Every push auto-deploys.

> Custom domain went live 1 Jun 2026. DNS managed via Cloudflare. Both URLs serve the same deployment — no separate branch.

## DNS & Domain

| | |
|---|---|
| **Primary** | `app.handbookhq.in` |
| **DNS provider** | Cloudflare |
| **Vercel project domain** | `clubkeeper` (auto-assigns `clubkeeper.vercel.app`) |
| **SSL** | Auto via Vercel |
| **To revert** | Remove custom domain from Vercel dashboard; `clubkeeper.vercel.app` continues working. |

## Pushing Changes (Sugeet's workflow)

Standard flow whenever code changes:

```powershell
git add .
git commit -m "describe what you changed"
git push
```

Vercel auto-deploys in ~30-60 seconds. Same URL.

## Local Development

```powershell
cd $HOME\Documents\clubkeeper
npm run dev
```

Opens at `localhost:5173`.

## Build Verification

Before pushing:

```powershell
npm run build
```

Should output `dist/` folder. If errors, fix them — Vercel will also fail otherwise.

## Common Git Issues

### Authentication failure on push

Use **Personal Access Token** (not GitHub password). Create at:
https://github.com/settings/tokens → Generate new token (classic) → scope: `repo`.

Paste the token as the password when Git prompts.

### "src refspec main does not match"

Means there's no commit yet. Run:
```powershell
git add .
git commit -m "initial"
git branch -M main
git push -u origin main
```

### "Repository not found"

The GitHub repo doesn't exist yet. Create it at https://github.com/new — public, no README/gitignore/license — then `git push -u origin main`.

### "Author identity unknown"

```powershell
git config --global user.email "you@email.com"
git config --global user.name "Sugeet"
```

### CRLF / LF warnings

Harmless on Windows. Git is normalizing line endings. Ignore.

## Vercel Configuration

Auto-detected for Vite projects. No `vercel.json` needed unless customizing.

Build settings (auto-detected):
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

## Environment Variables (when added)

Future, when adding Supabase/Razorpay:

In Vercel dashboard → Project Settings → Environment Variables:
- `VITE_SUPABASE_URL` — public, OK to expose
- `VITE_SUPABASE_ANON_KEY` — public, OK to expose (anon key has limited perms)
- `VITE_RAZORPAY_KEY_ID` — public

For secret keys (NEVER prefix with `VITE_`):
- `RAZORPAY_KEY_SECRET` — server-side only, use in Vercel serverless function

**Rule:** Anything starting with `VITE_` is shipped to the browser. Don't put secrets there.

## Custom Domain (Future)

When ready (~first paying customer):

1. Buy domain on Namecheap / GoDaddy: `clubkeeper.in` (~₹800/year)
2. In Vercel: Project → Domains → Add `clubkeeper.in`
3. Vercel shows DNS records to add at the registrar
4. Add A/CNAME records as instructed
5. Wait ~10 mins for SSL + DNS propagation
6. Done — `https://clubkeeper.in` works

## PWA Install on Phone

For owner to install:
1. Open URL in **Chrome** on Android
2. Chrome menu (3 dots) → "Add to Home screen"
3. Confirm → app icon on home screen
4. Tapping opens fullscreen (no browser UI)

On iPhone (Safari):
1. Open URL in Safari
2. Share button → "Add to Home Screen"
3. Confirm → app icon

iOS PWAs are slightly weaker (no push notifications) but core app works.

## Monitoring (when needed)

For v1 with no users: skip monitoring.

When users join:
- **Vercel Analytics** (free tier): page views, basic perf
- **Sentry** (free for solo dev): error tracking
- **PostHog** (free for small teams): product analytics + replays

Don't add these until there's data to look at. Premature instrumentation slows you down.

## Backup Strategy

Currently: Sugeet's IndexedDB is on his own phone/laptop. If lost, lost.

Customer data is on customer devices. They lose their own data if they uninstall.

Add `Settings → Export All Data (JSON)` button so users can self-backup. (Already in Prompt 6.)

When cloud sync is added, Supabase auto-backups solve this.

## Rollback Plan

If a deploy breaks production:

1. Vercel dashboard → Deployments
2. Find last working deployment
3. Click "..." → "Promote to Production"
4. Done — old version restored in seconds

Or revert in Git:
```powershell
git revert HEAD
git push
```

## Performance Targets

- Lighthouse mobile score: 90+
- First Contentful Paint: <1.5s on 4G
- Bundle size: <300KB gzipped
- Time to Interactive: <3s on slow phone

Check periodically with Chrome DevTools → Lighthouse.

## Security Checklist (before public launch)

- [ ] No API keys in client code
- [ ] No `console.log` of sensitive data
- [ ] HTTPS only (Vercel enforces this)
- [ ] Service Worker doesn't cache sensitive endpoints (when added)
- [ ] CSP headers configured (when more sensitive data lands)
- [ ] Rate limiting on signup/login (when auth added)

For pure offline v1, security surface is minimal. Tighten when cloud comes.
