/**
 * tests/d9-step8.spec.ts
 *
 * Phase D — Chunk D9, STEP 8 (account-switch / no-data-bleed), automated as the
 * seed of the permanent smoke suite. Runs against the DEPLOYED app (prod-auth
 * project, baseURL = PW_BASE_URL ?? https://app.handbookhq.in) so staff JWTs and
 * per-user Dexie DBs are REAL — SQL-editor checks prove nothing here (Rule: a
 * fresh sign-in is the only proof of the access-token hook + RLS scope).
 *
 * This is EXPERIMENT infra: run manually only (no CI, no loops). T3 (create
 * PW-Staff2 via /api/create-staff) is deliberately NOT here — it mutates prod
 * auth and depends on the serverless endpoint being reachable from the test
 * context; it lands separately once that path is confirmed.
 *
 * Auth:
 *   - Owner  → storageState .auth/user.json (Google session; the config's
 *              prod-auth project loads it). Refresh it with the local-auth
 *              setup project if it has expired.
 *   - Staff  → PW_STAFF_EMAIL / PW_STAFF_PASSWORD from .env.test (gitignored).
 *              NEVER hardcode real staff creds in this tracked file. If unset,
 *              the staff-dependent tests SOFT-SKIP with a loud banner (never a
 *              hard fail for a missing secret).
 *
 * DB name: ClubKeeperDB_<userId> — userId read from the sb-*-auth-token
 * localStorage entry at runtime (same helper shape as canteen-calculations.spec).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import fs from 'fs'
import path from 'path'

// ─── Env (.env.test, gitignored) ─────────────────────────────────────────────
// Minimal dotenv: no dependency on a dotenv package. Reads KEY=VALUE lines.
function loadEnvTest(): void {
  const p = path.resolve(process.cwd(), '.env.test')
  if (!fs.existsSync(p)) return
  const raw = fs.readFileSync(p, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}
loadEnvTest()

const STAFF_EMAIL = process.env.PW_STAFF_EMAIL ?? ''
const STAFF_PASSWORD = process.env.PW_STAFF_PASSWORD ?? ''
const HAVE_STAFF_CREDS = STAFF_EMAIL.length > 0 && STAFF_PASSWORD.length > 0

// Demo-seed table names (src/db/seed.ts). A staff device that pulled the real
// club must show ZERO of these — their presence = demo seed leaked into the
// staff DB (a data-bleed / seed-gate failure).
const DEMO_SEED_NAMES = ['Pool 1', 'Pool 2', 'Snooker 1', 'Carrom 1', 'Carrom 2']

// ─── Helpers (mirror canteen-calculations.spec conventions) ──────────────────

/** Read the Supabase userId from localStorage → ClubKeeperDB_<uid>, or null. */
async function getDbName(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const keys = Object.keys(localStorage)
    const tokenKey = keys.find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    if (!tokenKey) return null
    try {
      const raw = localStorage.getItem(tokenKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as { user?: { id?: string } }
      const userId = parsed?.user?.id
      if (!userId) return null
      return `ClubKeeperDB_${userId}`
    } catch {
      return null
    }
  })
}

/** All gameTables names in the named IndexedDB. Empty array if store absent. */
async function readGameTableNames(page: Page, dbName: string): Promise<string[]> {
  return page.evaluate((name: string) => {
    return new Promise<string[]>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onerror = () => reject(new Error(`IDB open failed: ${String(req.error)}`))
      req.onsuccess = () => {
        const db = req.result
        if (!Array.from(db.objectStoreNames).includes('gameTables')) {
          db.close()
          resolve([])
          return
        }
        const tx = db.transaction(['gameTables'], 'readonly')
        const getAll = tx.objectStore('gameTables').getAll()
        getAll.onerror = () => { db.close(); reject(new Error(`getAll failed: ${String(getAll.error)}`)) }
        getAll.onsuccess = () => {
          const rows = (getAll.result ?? []) as Array<{ name?: string }>
          db.close()
          resolve(rows.map((r) => (typeof r.name === 'string' ? r.name : '')))
        }
      }
    })
  }, dbName)
}

/** true if indexedDB.databases() lists the given name (Chromium supports it). */
async function idbDatabaseExists(page: Page, dbName: string): Promise<boolean> {
  return page.evaluate(async (name: string) => {
    if (!('databases' in indexedDB)) return true // can't enumerate → don't fail the run
    const dbs = await indexedDB.databases()
    return dbs.some((d) => d.name === name)
  }, dbName)
}

/** Sign in a fresh staff context on the given page. Returns the staff dbName. */
async function staffSignIn(page: Page): Promise<string> {
  await page.goto('/signup', { waitUntil: 'domcontentloaded' })
  // Expand the collapsed staff sign-in section.
  await page.getByRole('button', { name: 'Staff sign-in' }).click()
  await page.getByLabel('Staff username').fill(STAFF_EMAIL)
  await page.getByLabel('Staff password').fill(STAFF_PASSWORD)
  // The section's own "Sign in" button (the last one is the Google "Already
  // have an account?" button — target the one after the password field).
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click()
  await page.waitForURL('**/tables', { timeout: 20000 })
  const dbName = await getDbName(page)
  if (!dbName) throw new Error('Staff signed in but no userId in localStorage')
  return dbName
}

let SKIP_BANNER_SHOWN = false
function softSkipBanner(reason: string): void {
  if (!SKIP_BANNER_SHOWN) {
    SKIP_BANNER_SHOWN = true
    console.log('')
    console.log('┌─────────────────────────────────────────────────────────────────────────┐')
    console.log('│  D9-STEP8 SKIP — a prerequisite is missing, test(s) soft-skipping        │')
    console.log(`│  Reason: ${reason.slice(0, 63).padEnd(63)} │`)
    console.log('│  Staff creds: set PW_STAFF_EMAIL / PW_STAFF_PASSWORD in .env.test        │')
    console.log('│  Owner state: npx playwright test --project=setup (re-login if expired)  │')
    console.log('└─────────────────────────────────────────────────────────────────────────┘')
    console.log('')
  }
}

// ─── T1 — staff sign-in populates a real, demo-free staff DB ─────────────────

test.describe('D9 step 8 — account switch / no data bleed', () => {
  test('T1 — staff sign-in: real tables, zero demo-seed, correct DB name', async ({ page }) => {
    test.skip(!HAVE_STAFF_CREDS, 'PW_STAFF_EMAIL/PW_STAFF_PASSWORD not set')
    if (!HAVE_STAFF_CREDS) { softSkipBanner('staff creds unset'); return }

    const staffDb = await staffSignIn(page)

    // DB name is the per-user staff DB.
    expect(staffDb).toMatch(/^ClubKeeperDB_[0-9a-f-]{36}$/)
    expect(await idbDatabaseExists(page, staffDb)).toBe(true)

    // Real tables present, NONE of them demo-seed names.
    const names = await readGameTableNames(page, staffDb)
    expect(names.length, 'staff DB should have pulled the club tables').toBeGreaterThan(0)
    for (const demo of DEMO_SEED_NAMES) {
      expect(names, `demo-seed table "${demo}" must NOT be in the staff DB`).not.toContain(demo)
    }
  })

  // ─── T2 — account switch: owner DB ≠ staff DB, no owner UI for staff ─────────

  test('T2 — account switch: distinct DBs, staff sees no owner-only UI', async ({ browser }, testInfo) => {
    test.skip(!HAVE_STAFF_CREDS, 'PW_STAFF_EMAIL/PW_STAFF_PASSWORD not set')
    if (!HAVE_STAFF_CREDS) { softSkipBanner('staff creds unset'); return }

    // ── Owner context (storageState from the project config) ──
    const ownerCtx: BrowserContext = await browser.newContext({
      storageState: '.auth/user.json',
      baseURL: testInfo.project.use.baseURL,
    })
    const ownerPage = await ownerCtx.newPage()
    await ownerPage.goto('/tables', { waitUntil: 'domcontentloaded' })

    // If the owner state expired, /tables bounces — soft-skip rather than fail.
    if (!ownerPage.url().includes('/tables')) {
      softSkipBanner('owner storageState expired (/tables redirected)')
      await ownerCtx.close()
      test.skip(true, 'owner storageState expired')
      return
    }

    const ownerDb = await getDbName(ownerPage)
    expect(ownerDb, 'owner should have a per-user DB name').not.toBeNull()
    // Owner sees the owner-only Add-Table FAB.
    await expect(ownerPage.getByLabel('Add table')).toBeVisible()

    // ── Staff context (fresh, isolated — the "account switch" on the device) ──
    const staffCtx: BrowserContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
    })
    const staffPage = await staffCtx.newPage()
    const staffDb = await staffSignIn(staffPage)

    // The core no-bleed assertion: the two per-user DBs are different names.
    expect(staffDb).not.toBe(ownerDb)

    // Staff must NOT see the owner-only Add-Table FAB (Pattern A12).
    await expect(staffPage.getByLabel('Add table')).toHaveCount(0)

    // /piggy deep-link bounces staff back to /tables (RequireOwner).
    await staffPage.goto('/piggy', { waitUntil: 'domcontentloaded' })
    await staffPage.waitForURL('**/tables', { timeout: 10000 })
    expect(staffPage.url()).toContain('/tables')

    // Staff Dexie shows only the staff club's rows, none of the demo seed.
    const staffNames = await readGameTableNames(staffPage, staffDb)
    for (const demo of DEMO_SEED_NAMES) {
      expect(staffNames, `demo-seed "${demo}" must not leak into staff DB`).not.toContain(demo)
    }

    await staffCtx.close()
    await ownerCtx.close()
  })

  // T3 (staff2 create/reset round-trip via /api/create-staff) is deferred —
  // it mutates prod auth and needs the serverless endpoint reachable from the
  // test context. Tracked separately; do NOT add it here without cleanup proof.
})
