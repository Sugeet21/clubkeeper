# Architecture

## Tech Stack (LOCKED)

| Layer | Choice | Why |
|---|---|---|
| Build tool | Vite 5.x | Fast HMR, excellent TypeScript support |
| UI framework | React 18.3.x | Sugeet's familiarity, ecosystem |
| Language | TypeScript 5.x strict mode | Catches bugs at compile time, Sugeet doesn't know JS deeply |
| Styling | Tailwind CSS **3.4.x** | NEVER upgrade to v4 — broke PostCSS in tests |
| Storage | Dexie 4.x (IndexedDB wrapper) | Offline-first requirement; SQL-like API simpler than raw IndexedDB |
| Routing | react-router-dom 6.x | Standard React routing |
| Dates | date-fns 3.x | Timezone-safe, tree-shakeable |
| State | Zustand 4.x | Tiny (~1KB), no Redux complexity |
| PWA | vite-plugin-pwa 0.20.x | Auto service worker + manifest |
| Live queries | dexie-react-hooks | Auto re-render on DB changes |

## File Structure

```
src/
  components/      # Reusable UI: Button, Card, Toggle, ConfirmModal, etc.
  pages/           # Home, Summary, History, Settings, StartSession, SessionDetail
  db/
    database.ts    # Dexie instance + schema
    queries.ts     # All CRUD functions (one source of truth)
    seed.ts        # Initial seed data on first run
  store/           # Zustand stores (toast, install prompt, etc.)
  hooks/
    useTick.ts     # Force re-render every 1s for timers
    useLiveData.ts # Wrappers around useLiveQuery
  lib/
    time.ts        # getElapsedMs, formatHMS, formatHM
    money.ts       # calculateAmount, formatINR, applyRounding
    validation.ts  # Input validators (name, note, table name)
    utils.ts       # cn() class joiner, formatTime12h
  types/
    index.ts       # All TypeScript interfaces (GameTable, Session, ClubSettings)
  App.tsx          # Router + ErrorBoundary + ToastContainer
  main.tsx         # Entry, calls seedIfEmpty before mount
  index.css        # Tailwind directives + fonts + safe-area CSS
```

## Routing Map

| Path | Page | Purpose |
|---|---|---|
| `/` | Home | Tables grid with live timers |
| `/start/:tableId` | StartSession | Form to begin new session |
| `/session/:sessionId` | SessionDetail | Big timer + pause/stop/edit |
| `/summary` | Summary | Daily revenue + sessions list |
| `/history` | History | Multi-day session history with filters |
| `/settings` | Settings | Club name, rounding, table management |

## Critical Patterns

### Timer Implementation Pattern
```ts
// CORRECT — derived from timestamps
function getElapsedMs(session: Session): number {
  if (session.status === 'completed') 
    return (session.endedAt - session.startedAt) - session.pausedTotalMs;
  if (session.status === 'paused')
    return (session.pausedAt - session.startedAt) - session.pausedTotalMs;
  // running
  return (Date.now() - session.startedAt) - session.pausedTotalMs;
}

// WRONG — counter that resets on refresh
const [elapsed, setElapsed] = useState(0);
useEffect(() => { setInterval(() => setElapsed(e => e + 1000), 1000); }, []);
```

### Live Query Pattern
```ts
// CORRECT — auto-updates when DB changes
function useTables() {
  return useLiveQuery(() => db.tables.orderBy('sortOrder').toArray());
}

// WRONG — manually fetching, won't update
const [tables, setTables] = useState([]);
useEffect(() => { db.tables.toArray().then(setTables); }, []);
```

### Component Pattern
- Functional components only, no class components
- Props typed via interface, never inline
- Tailwind classes via `cn()` helper for conditionals
- Inline SVG icons (no icon library), stroke="currentColor"
- Touch targets minimum 44×44px

## Future Architecture (When Adding Cloud Sync)

When Sugeet decides to add auth + cloud sync:

1. **Add Supabase** — Postgres + auth + realtime out of the box. Free tier generous.
2. **Keep Dexie** — local cache stays. Supabase becomes the source of truth, Dexie syncs on online.
3. **Sync strategy** — last-write-wins on session updates. Conflict UI not needed for solo-owner app.
4. **Migration path** — existing offline-only users: on first auth, push their local DB to Supabase as their initial state.

Do NOT implement this until Sugeet has paying customers asking for multi-device support.

## Performance Guidelines

- `useTick` at 1-second interval is fine. Never go faster.
- Don't query inside render — only via `useLiveQuery` hooks.
- Lists with 50+ items: use simple `.map`, no virtualization needed for v1.
- Bundle size target: <300kb gzipped. Run `npm run build` and check `dist/` sizes occasionally.

## Build & Deploy

- Local dev: `npm run dev` → localhost:5173
- Production build: `npm run build` → `dist/` folder
- Deploy: Push to `main` branch on GitHub → Vercel auto-deploys
- Hosting: Vercel free tier
- Domain: subdomain on vercel.app for now. Custom domain (e.g. clubkeeper.in) costs ~₹800/year, add when first paying customer signs.
