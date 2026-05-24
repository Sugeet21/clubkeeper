/**
 * tests/settings.spec.ts — Bug inventory for /settings
 * Phase 1b: INVENTORY ONLY. No src/ changes.
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

test.describe('/settings — Settings page', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // 1. Navigate
    try {
      await page.goto('/settings', { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation to /settings failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(2000)
    const landedUrl = page.url()

    if (!landedUrl.includes('/settings')) {
      bugs.push({
        id: 'AUTH_REDIRECT',
        viewport,
        title: `/settings redirected to ${landedUrl}`,
        detail: 'Auth guard fired.',
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // Console errors (filter 401s which are expected with mock auth)
    const settingsErrors = errors.filter(e => !e.includes('401'))
    if (settingsErrors.length > 0) {
      bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors on /settings load', errors: settingsErrors })
    }

    // 2. Overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) bugs.push({ id: 'OVERFLOW', viewport, title: 'Horizontal overflow on /settings', detail: overflow })
    } catch (e) { bugs.push({ id: 'OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` }) }

    // 3. Touch targets (mobile)
    if (viewport === 'mobile-360-auth') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) bugs.push({ id: 'TOUCH', viewport, title: 'Buttons < 44×44px on /settings', buttons: small })
      } catch (e) { bugs.push({ id: 'TOUCH_ERR', viewport, title: `Touch check threw: ${e}` }) }
    }

    // 4. img dimensions
    try {
      const imgs = await imgsWithoutDimensions(page)
      if (imgs.length > 0) bugs.push({ id: 'IMG_DIMS', viewport, title: '<img> missing dimensions on /settings', imgs })
    } catch (e) { bugs.push({ id: 'IMG_ERR', viewport, title: `img check threw: ${e}` }) }

    // 5. BottomNav visible
    try {
      const nav = page.locator('nav').first()
      if (!await nav.isVisible()) {
        bugs.push({ id: 'BOTTOMNAV', viewport, title: 'BottomNav not visible on /settings' })
      }
    } catch (e) { bugs.push({ id: 'BOTTOMNAV_ERR', viewport, title: `BottomNav check threw: ${e}` }) }

    // 6. Page heading "Settings"
    try {
      const heading = page.locator('h1:has-text("Settings")').first()
      if (!await heading.isVisible()) {
        bugs.push({ id: 'HEADING', viewport, title: 'H1 "Settings" heading not visible' })
      }
    } catch (e) { bugs.push({ id: 'HEADING_ERR', viewport, title: `Heading check threw: ${e}` }) }

    // 7. Key sections present
    try {
      const sections = ['Club Info', 'Tables', 'Data', 'About', 'Account']
      for (const section of sections) {
        const el = page.locator(`text=${section}`).first()
        if (!await el.isVisible()) {
          bugs.push({ id: `SECTION_${section.replace(' ', '_').toUpperCase()}`, viewport, title: `Section "${section}" not visible on /settings` })
        }
      }
    } catch (e) { bugs.push({ id: 'SECTIONS_ERR', viewport, title: `Sections check threw: ${e}` }) }

    // 8. "Add Table" button in Tables section opens modal
    try {
      const addTableBtn = page.locator('button:has-text("+ Add Table")').first()
      const addVisible = await addTableBtn.isVisible()
      if (!addVisible) {
        bugs.push({ id: 'ADD_TABLE_BTN', viewport, title: '"+ Add Table" button not visible in Tables section' })
      } else {
        await addTableBtn.click()
        await page.waitForTimeout(500)
        // TableFormModal should open — look for a modal with an input
        const modalInput = page.locator('input[placeholder*="name"]').first()
          || page.locator('[role="dialog"]').first()
        const modalOpen = await page.locator('text=/Add Table|New Table|Table Name/i').first().isVisible()
        if (!modalOpen) {
          bugs.push({ id: 'ADD_TABLE_MODAL', viewport, title: '"+ Add Table" click did not open TableFormModal' })
        } else {
          // Close modal — press Escape or find Cancel
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
        }
      }
    } catch (e) { bugs.push({ id: 'ADD_TABLE_ERR', viewport, title: `Add Table modal check threw: ${e}` }) }

    // 9. Time Rounding toggle — 3 options (None, 15 min, 30 min)
    try {
      const noneBtn = page.locator('button:has-text("None")').first()
      const fifteenBtn = page.locator('button:has-text("15 min")').first()
      const thirtyBtn = page.locator('button:has-text("30 min")').first()
      const allVisible = await Promise.all([
        noneBtn.isVisible(),
        fifteenBtn.isVisible(),
        thirtyBtn.isVisible(),
      ])
      if (!allVisible.every(Boolean)) {
        bugs.push({
          id: 'ROUNDING_TOGGLE',
          viewport,
          title: 'Time rounding toggle buttons not all visible',
          detail: `None: ${allVisible[0]}, 15min: ${allVisible[1]}, 30min: ${allVisible[2]}`,
        })
      } else {
        // Click 15 min and verify it becomes active
        await fifteenBtn.click()
        await page.waitForTimeout(300)
        // Check the button has active styling (bg-accent class)
        const isActive = await fifteenBtn.evaluate((el) =>
          el.className.includes('bg-accent') || el.className.includes('text-bg')
        )
        if (!isActive) {
          bugs.push({ id: 'ROUNDING_TOGGLE_ACTIVE', viewport, title: '"15 min" rounding button did not become active after click' })
        }
        // Restore to None
        await noneBtn.click()
        await page.waitForTimeout(300)
      }
    } catch (e) { bugs.push({ id: 'ROUNDING_ERR', viewport, title: `Rounding toggle check threw: ${e}` }) }

    // 10. Subscription section — visible only if subscription is not 'none'
    try {
      const subSection = page.locator('text=Subscription').first()
      const subVisible = await subSection.isVisible()
      // Subscription section may or may not be shown depending on auth state
      // If visible, check the key fields render
      if (subVisible) {
        const planField = page.locator('text=Plan').first()
        const statusField = page.locator('text=Status').first()
        const planVisible = await planField.isVisible()
        const statusVisible = await statusField.isVisible()
        if (!planVisible || !statusVisible) {
          bugs.push({
            id: 'SUB_SECTION_FIELDS',
            viewport,
            title: 'Subscription section visible but Plan/Status fields missing',
            detail: `Plan: ${planVisible}, Status: ${statusVisible}`,
          })
        }
      }
    } catch (e) { bugs.push({ id: 'SUB_ERR', viewport, title: `Subscription section check threw: ${e}` }) }

    // 11. Cancel subscription modal
    try {
      const cancelBtn = page.locator('button:has-text("Cancel subscription")').first()
      const cancelVisible = await cancelBtn.isVisible()
      if (cancelVisible) {
        await cancelBtn.click()
        await page.waitForTimeout(500)
        const modal = page.locator('text=Cancel subscription?').first()
        const modalOpen = await modal.isVisible()
        if (!modalOpen) {
          bugs.push({ id: 'CANCEL_MODAL', viewport, title: '"Cancel subscription" click did not open confirm modal' })
        } else {
          // Close with "Keep plan"
          const keepBtn = page.locator('button:has-text("Keep plan")').first()
          const keepVisible = await keepBtn.isVisible()
          if (!keepVisible) {
            bugs.push({ id: 'CANCEL_MODAL_KEEP', viewport, title: '"Keep plan" button not found in cancel modal' })
          } else {
            await keepBtn.click()
            await page.waitForTimeout(300)
          }
        }
      }
    } catch (e) { bugs.push({ id: 'CANCEL_ERR', viewport, title: `Cancel modal check threw: ${e}` }) }

    // 12. Sign Out button — verify it's clickable and navigates away
    try {
      const signOutBtn = page.locator('button:has-text("Sign Out")').first()
      const signOutVisible = await signOutBtn.isVisible()
      if (!signOutVisible) {
        bugs.push({ id: 'SIGNOUT_BTN', viewport, title: '"Sign Out" button not visible in Account section' })
      } else {
        // Check it's enabled
        const isDisabled = await signOutBtn.isDisabled()
        if (isDisabled) {
          bugs.push({ id: 'SIGNOUT_DISABLED', viewport, title: '"Sign Out" button is disabled' })
        }
        // NOTE: We do NOT click Sign Out to avoid breaking auth for subsequent tests
        // Instead just verify its presence and enabled state
      }
    } catch (e) { bugs.push({ id: 'SIGNOUT_ERR', viewport, title: `Sign Out check threw: ${e}` }) }

    // 13. "Clear All Sessions" opens confirm modal
    try {
      const clearBtn = page.locator('button:has-text("Clear All Sessions")').first()
      const clearVisible = await clearBtn.isVisible()
      if (!clearVisible) {
        bugs.push({ id: 'CLEAR_BTN', viewport, title: '"Clear All Sessions" button not visible' })
      } else {
        await clearBtn.click()
        await page.waitForTimeout(500)
        const modal = page.locator('text=Clear all sessions?').first()
        const modalOpen = await modal.isVisible()
        if (!modalOpen) {
          bugs.push({ id: 'CLEAR_MODAL', viewport, title: '"Clear All Sessions" click did not open confirm modal' })
        } else {
          // Cancel — use testid to avoid matching "Cancel subscription" row button
          const cancelModalBtn = page.locator('[data-testid="clear-modal-cancel"]')
          await cancelModalBtn.click()
          await page.waitForTimeout(300)
        }
      }
    } catch (e) { bugs.push({ id: 'CLEAR_ERR', viewport, title: `Clear sessions modal check threw: ${e}` }) }

    // 14. Storage info row visible (if browser supports it)
    // Storage estimate is async so it may or may not appear — just log
    try {
      const storageRow = page.locator('text=Storage Used').first()
      const storageVisible = await storageRow.isVisible()
      // This is informational — browser must support navigator.storage.estimate()
      if (storageVisible) {
        const storageValue = await storageRow.locator('..').textContent()
        if (storageValue && storageValue.includes('undefined')) {
          bugs.push({ id: 'STORAGE_UNDEFINED', viewport, title: 'Storage info shows "undefined"', detail: storageValue })
        }
      }
    } catch (e) { bugs.push({ id: 'STORAGE_ERR', viewport, title: `Storage info check threw: ${e}` }) }

    // 15. Back/Home button navigates to /tables
    try {
      const homeBtn = page.locator('button:has-text("Home")').first()
      const homeVisible = await homeBtn.isVisible()
      if (!homeVisible) {
        bugs.push({ id: 'HOME_BTN', viewport, title: '"Home" back button not visible on /settings' })
      } else {
        await homeBtn.click()
        await page.waitForURL('**/tables', { timeout: 5000 })
        const afterUrl = page.url()
        if (!afterUrl.includes('/tables')) {
          bugs.push({ id: 'HOME_BTN_NAV', viewport, title: `"Home" button on /settings did not navigate to /tables: ${afterUrl}` })
        }
      }
    } catch (e) { bugs.push({ id: 'HOME_BTN_ERR', viewport, title: `Home button check threw: ${e}` }) }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
