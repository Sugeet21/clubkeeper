/**
 * tests/history.spec.ts — Bug inventory for /history
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

test.describe('/history — Session history page', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // 1. Navigate
    try {
      await page.goto('/history', { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation to /history failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(2000)
    const landedUrl = page.url()

    if (!landedUrl.includes('/history')) {
      bugs.push({
        id: 'AUTH_REDIRECT',
        viewport,
        title: `/history redirected to ${landedUrl}`,
        detail: 'Auth guard fired — storageState insufficient.',
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // Console errors
    const historyErrors = errors.filter(e => !e.includes('401'))
    if (historyErrors.length > 0) {
      bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors on /history load', errors: historyErrors })
    }

    // 2. Overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) bugs.push({ id: 'OVERFLOW', viewport, title: 'Horizontal overflow on /history', detail: overflow })
    } catch (e) { bugs.push({ id: 'OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` }) }

    // 3. Touch targets (mobile)
    if (viewport === 'mobile-360-auth') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) bugs.push({ id: 'TOUCH', viewport, title: 'Buttons < 44×44px on /history', buttons: small })
      } catch (e) { bugs.push({ id: 'TOUCH_ERR', viewport, title: `Touch check threw: ${e}` }) }
    }

    // 4. img dimensions
    try {
      const imgs = await imgsWithoutDimensions(page)
      if (imgs.length > 0) bugs.push({ id: 'IMG_DIMS', viewport, title: '<img> missing dimensions on /history', imgs })
    } catch (e) { bugs.push({ id: 'IMG_ERR', viewport, title: `img check threw: ${e}` }) }

    // 5. BottomNav visible
    try {
      const nav = page.locator('nav').first()
      if (!await nav.isVisible()) {
        bugs.push({ id: 'BOTTOMNAV', viewport, title: 'BottomNav not visible on /history' })
      }
    } catch (e) { bugs.push({ id: 'BOTTOMNAV_ERR', viewport, title: `BottomNav check threw: ${e}` }) }

    // 6. Page heading "History"
    try {
      const heading = page.locator('h1:has-text("History")').first()
      const headingVisible = await heading.isVisible()
      if (!headingVisible) {
        bugs.push({ id: 'HEADING', viewport, title: 'H1 "History" heading not visible' })
      }
    } catch (e) { bugs.push({ id: 'HEADING_ERR', viewport, title: `Heading check threw: ${e}` }) }

    // 7. Date filter inputs present
    try {
      const fromInput = page.locator('input[type="date"]').first()
      const toInput = page.locator('input[type="date"]').nth(1)
      const fromVisible = await fromInput.isVisible()
      const toVisible = await toInput.isVisible()
      if (!fromVisible || !toVisible) {
        bugs.push({
          id: 'DATE_FILTERS',
          viewport,
          title: 'Date filter inputs not visible',
          detail: `From: ${fromVisible}, To: ${toVisible}`,
        })
      } else {
        // Test date filter: change "From" date to today
        const today = new Date().toISOString().slice(0, 10)
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)

        // Set from = yesterday and to = today, verify inputs accept values
        await fromInput.fill(yesterday)
        await page.waitForTimeout(500)
        const fromValue = await fromInput.inputValue()
        if (fromValue !== yesterday) {
          bugs.push({
            id: 'DATE_FILTER_FROM',
            viewport,
            title: `From date input did not update: set ${yesterday}, got ${fromValue}`,
          })
        }

        await toInput.fill(today)
        await page.waitForTimeout(500)
        const toValue = await toInput.inputValue()
        if (toValue !== today) {
          bugs.push({
            id: 'DATE_FILTER_TO',
            viewport,
            title: `To date input did not update: set ${today}, got ${toValue}`,
          })
        }
      }
    } catch (e) { bugs.push({ id: 'DATE_ERR', viewport, title: `Date filter check threw: ${e}` }) }

    // 8. Empty state OR session rows render
    try {
      const emptyState = page.locator('text=/No sessions in this range|No sessions for selected table/i').first()
      const hasEmpty = await emptyState.isVisible()
      const hasRows = await page.locator('[class*="bg-bg-card"][class*="rounded-2xl"]').count() > 0
      if (!hasEmpty && !hasRows) {
        bugs.push({ id: 'CONTENT', viewport, title: 'History shows neither sessions nor empty state' })
      }
    } catch (e) { bugs.push({ id: 'CONTENT_ERR', viewport, title: `Content check threw: ${e}` }) }

    // 9. Indian rupee formatting on amounts (if sessions exist)
    try {
      const amountEls = await page.locator('text=/₹/').all()
      if (amountEls.length > 0) {
        // Check at least one uses Indian number formatting (could have commas like 1,000)
        let foundBadFormat = false
        for (const el of amountEls.slice(0, 5)) {
          const text = await el.textContent()
          if (text && text.includes('₹')) {
            // Indian format: amounts above 999 should use en-IN (e.g., ₹1,200 not $1,200)
            // Just verify ₹ is present — detailed formatting requires a specific known amount
            if (!text.startsWith('₹') && !text.includes('₹')) {
              foundBadFormat = true
            }
          }
        }
        if (foundBadFormat) {
          bugs.push({ id: 'RUPEE_FORMAT', viewport, title: 'Amount displayed without ₹ prefix' })
        }
      }
    } catch (e) { bugs.push({ id: 'RUPEE_ERR', viewport, title: `Rupee format check threw: ${e}` }) }

    // 10. Check amount column uses toLocaleString('en-IN') vs raw number
    // This is a code-read check — from History.tsx:79 the amount is: {currency}{amount}
    // where currency = '₹' and amount is a raw number (NOT formatted with toLocaleString)
    // This means amounts > 999 will display as ₹1000 not ₹1,000
    try {
      const rawAmountCheck = await page.evaluate(() => {
        // Find session row amounts rendered as plain numbers vs formatted
        const els = Array.from(document.querySelectorAll('[class*="tabular-nums"]'))
        const found: string[] = []
        for (const el of els) {
          const text = (el.textContent ?? '').trim()
          if (text.startsWith('₹')) {
            const num = parseFloat(text.replace('₹', '').replace(/,/g, ''))
            if (num >= 1000) {
              // Should have comma: ₹1,000 — check if it does
              if (!text.includes(',')) {
                found.push(`"${text}" should be formatted with commas for en-IN`)
              }
            }
          }
        }
        return found
      })
      if (rawAmountCheck.length > 0) {
        bugs.push({
          id: 'AMOUNT_FORMAT_HISTORY',
          viewport,
          title: 'Session amounts ≥ ₹1,000 not formatted with en-IN commas in History',
          detail: `In History.tsx:79 — "{currency}{amount}" renders raw number. Should be: "{currency}{amount.toLocaleString(\'en-IN\')}". Affected: ${rawAmountCheck.join(', ')}`,
          suspectedFile: 'src/pages/History.tsx:79',
        })
      }
    } catch (e) { bugs.push({ id: 'AMOUNT_FORMAT_ERR', viewport, title: `Amount format check threw: ${e}` }) }

    // 11. Export button (only visible if sessions exist)
    try {
      const exportBtn = page.locator('button:has-text("Export")').first()
      const exportVisible = await exportBtn.isVisible()
      // If there are sessions, Export should be visible; if empty, it's hidden — both are valid
      // Just log if it's visible and check it's tappable
      if (exportVisible) {
        const isDisabled = await exportBtn.isDisabled()
        if (isDisabled) {
          bugs.push({ id: 'EXPORT_DISABLED', viewport, title: 'Export button visible but disabled' })
        }
      }
    } catch (e) { bugs.push({ id: 'EXPORT_ERR', viewport, title: `Export button check threw: ${e}` }) }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
