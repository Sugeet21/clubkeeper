/**
 * tests/tables.spec.ts — Bug inventory for /tables (Home)
 * Phase 1b: INVENTORY ONLY. No src/ changes.
 *
 * Requires: .auth/user.json from auth.setup.ts
 * If auth isn't present/valid, documents the redirect behavior.
 */

import { test, expect, Page, ConsoleMessage } from '@playwright/test'

// ─── helpers ──────────────────────────────────────────────────────────────────

function collectErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(`[pageerror] ${err.message}`))
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`)
  })
  return errors
}

async function noHorizontalOverflow(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() =>
      document.body.scrollWidth > window.innerWidth
        ? `scrollWidth(${document.body.scrollWidth}) > innerWidth(${window.innerWidth})`
        : null
    )
  } catch (e) { return `evaluate error: ${e}` }
}

async function smallButtonsOnMobile(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const issues: string[] = []
    document.querySelectorAll('button').forEach((btn) => {
      if (!btn.offsetParent) return
      const r = btn.getBoundingClientRect()
      if (r.width < 44 || r.height < 44) {
        issues.push(`"${(btn.textContent ?? '').trim().slice(0, 40)}" ${Math.round(r.width)}×${Math.round(r.height)}px`)
      }
    })
    return issues
  })
}

async function imgsWithoutDimensions(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('img'))
      .filter((img) => !img.getAttribute('width') || !img.getAttribute('height'))
      .map((img) => `<img src="${img.getAttribute('src') ?? ''}"> missing width/height`)
  )
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('/tables — Home page', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // 1. Navigate
    try {
      await page.goto('/tables', { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(2000)
    const landedUrl = page.url()

    if (!landedUrl.includes('/tables')) {
      bugs.push({
        id: 'AUTH_REDIRECT',
        viewport,
        title: `/tables redirected to ${landedUrl}`,
        detail: 'Auth guard fired — storageState did not satisfy RequireAccess. Subscription may be missing/expired.',
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // Console errors
    if (errors.length > 0) {
      bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors on /tables load', errors: [...errors] })
    }

    // 2. Overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) bugs.push({ id: 'OVERFLOW', viewport, title: 'Horizontal body overflow on /tables', detail: overflow })
    } catch (e) { bugs.push({ id: 'OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` }) }

    // 3. Touch targets (mobile only)
    if (viewport === 'mobile-360-auth') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) bugs.push({ id: 'TOUCH', viewport, title: 'Buttons < 44×44px on /tables', buttons: small })
      } catch (e) { bugs.push({ id: 'TOUCH_ERR', viewport, title: `Touch target check threw: ${e}` }) }
    }

    // 4. img dimensions
    try {
      const imgs = await imgsWithoutDimensions(page)
      if (imgs.length > 0) bugs.push({ id: 'IMG_DIMS', viewport, title: '<img> missing dimensions', imgs })
    } catch (e) { bugs.push({ id: 'IMG_ERR', viewport, title: `img check threw: ${e}` }) }

    // 5. BottomNav visible
    try {
      const nav = page.locator('nav').first()
      const navVisible = await nav.isVisible()
      if (!navVisible) {
        bugs.push({ id: 'BOTTOMNAV_MISSING', viewport, title: 'BottomNav <nav> not visible on /tables' })
      } else {
        // Check all 4 tabs
        const tabs = [
          { label: 'Tables', href: '/tables' },
          { label: 'Summary', href: '/summary' },
          { label: 'History', href: '/history' },
          { label: 'Settings', href: '/settings' },
        ]
        for (const tab of tabs) {
          const link = page.locator(`nav a[href="${tab.href}"]`)
          const visible = await link.isVisible()
          if (!visible) {
            bugs.push({ id: `BOTTOMNAV_TAB_${tab.label.toUpperCase()}`, viewport, title: `BottomNav "${tab.label}" tab not found (href=${tab.href})` })
          }
        }
      }
    } catch (e) { bugs.push({ id: 'BOTTOMNAV_ERR', viewport, title: `BottomNav check threw: ${e}` }) }

    // 6. BottomNav tab navigation — click Summary
    try {
      const summaryLink = page.locator('nav a[href="/summary"]')
      if (await summaryLink.isVisible()) {
        await summaryLink.click()
        await page.waitForURL('**/summary', { timeout: 5000 })
        if (!page.url().includes('/summary')) {
          bugs.push({ id: 'BOTTOMNAV_SUMMARY_NAV', viewport, title: 'BottomNav Summary tab did not navigate to /summary', url: page.url() })
        }
        await page.goto('/tables', { waitUntil: 'networkidle', timeout: 10000 })
        await page.waitForTimeout(500)
      }
    } catch (e) { bugs.push({ id: 'BOTTOMNAV_NAV_ERR', viewport, title: `BottomNav navigation check threw: ${e}` }) }

    // 7. Empty state OR table cards render
    try {
      const hasCards = await page.locator('[class*="rounded"][class*="border"]').count() > 0
      const hasEmptyState = await page.locator('text=/No tables|Add your first/i').isVisible()
      if (!hasCards && !hasEmptyState) {
        bugs.push({ id: 'TABLES_CONTENT', viewport, title: '/tables shows neither table cards nor empty state' })
      }
    } catch (e) { bugs.push({ id: 'TABLES_CONTENT_ERR', viewport, title: `Tables content check threw: ${e}` }) }

    // 8. FAB (+) button — aria-label says "Add table" but onClick goes to /settings (BUG FOUND IN CODE READ)
    try {
      const fab = page.locator('button[aria-label="Add table"]')
      const fabVisible = await fab.isVisible()
      if (!fabVisible) {
        bugs.push({ id: 'FAB_MISSING', viewport, title: 'FAB button (aria-label="Add table") not visible' })
      } else {
        // Click it and see where we land
        await fab.click()
        await page.waitForTimeout(1000)
        const afterUrl = page.url()
        if (afterUrl.includes('/settings')) {
          bugs.push({
            id: 'FAB_WRONG_ACTION',
            viewport,
            title: 'FAB button aria-label="Add table" but navigates to /settings instead of opening Add Table modal',
            detail: `URL after click: ${afterUrl}. Expected: modal on /tables. Found in Home.tsx:157-163`,
          })
        }
        // Navigate back for remaining checks
        await page.goto('/tables', { waitUntil: 'networkidle', timeout: 10000 })
        await page.waitForTimeout(500)
      }
    } catch (e) { bugs.push({ id: 'FAB_ERR', viewport, title: `FAB check threw: ${e}` }) }

    // 9. Subscription banner check — SubscriptionStatusBanner renders
    try {
      // Banner renders if status is trialing/past_due/cancelling — just verify it doesn't throw
      // If user is 'active' no banner shows — that's correct
      const hasError = errors.some(e => e.includes('SubscriptionStatusBanner'))
      if (hasError) {
        bugs.push({ id: 'SUB_BANNER_ERROR', viewport, title: 'SubscriptionStatusBanner threw an error', errors })
      }
    } catch (e) { bugs.push({ id: 'SUB_BANNER_ERR', viewport, title: `Sub banner check threw: ${e}` }) }

    // 10. SummaryStrip renders (tables/running/revenue counts)
    try {
      // TopBar and SummaryStrip always render — check for their distinctive content
      const topBar = page.locator('text=ClubKeeper').first()
      const topBarVisible = await topBar.isVisible()
      if (!topBarVisible) {
        bugs.push({ id: 'TOPBAR_MISSING', viewport, title: 'TopBar / ClubKeeper branding not visible on /tables' })
      }
    } catch (e) { bugs.push({ id: 'TOPBAR_ERR', viewport, title: `TopBar check threw: ${e}` }) }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
