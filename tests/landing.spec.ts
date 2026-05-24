/**
 * tests/landing.spec.ts — Bug inventory for /
 * Phase 1a: INVENTORY ONLY. No src/ changes.
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
    const overflow = await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth
        ? `body.scrollWidth (${document.body.scrollWidth}) > innerWidth (${window.innerWidth})`
        : null
    })
    return overflow
  } catch (e) {
    return `evaluate error: ${e}`
  }
}

async function smallButtonsOnMobile(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const issues: string[] = []
    buttons.forEach((btn) => {
      if (!btn.offsetParent) return // not visible
      const r = btn.getBoundingClientRect()
      if (r.width < 44 || r.height < 44) {
        issues.push(
          `Button "${(btn.textContent ?? '').trim().slice(0, 40)}" is ${Math.round(r.width)}×${Math.round(r.height)}px (< 44×44)`
        )
      }
    })
    return issues
  })
}

async function imgsWithoutDimensions(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('img'))
      .filter((img) => !img.getAttribute('width') || !img.getAttribute('height'))
      .map((img) => `<img src="${img.getAttribute('src') ?? ''}"> missing width/height`)
  })
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('/ — Landing page', () => {
  test('all checks', async ({ page, browserName: _b }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // 1. Page loads
    try {
      const response = await page.goto('/', { waitUntil: 'networkidle', timeout: 20000 })
      if (!response || !response.ok()) {
        bugs.push({ id: 'LOAD', viewport, title: 'Page did not return 200', status: response?.status() })
      }
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    // Wait for React to hydrate
    await page.waitForTimeout(1500)

    // Flush console errors
    if (errors.length > 0) {
      bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors on load', errors: [...errors] })
    }

    // 2. No horizontal overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) {
        bugs.push({ id: 'OVERFLOW', viewport, title: 'Horizontal body overflow', detail: overflow })
      }
    } catch (e) {
      bugs.push({ id: 'OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` })
    }

    // 3. Button touch targets (mobile-360 only)
    if (viewport === 'mobile-360') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) {
          bugs.push({ id: 'TOUCH', viewport, title: 'Buttons < 44×44px', buttons: small })
        }
      } catch (e) {
        bugs.push({ id: 'TOUCH_ERR', viewport, title: `Touch target check threw: ${e}` })
      }
    }

    // 4. <img> width/height attributes
    try {
      const missingDims = await imgsWithoutDimensions(page)
      if (missingDims.length > 0) {
        bugs.push({ id: 'IMG_DIMS', viewport, title: '<img> missing width/height (CLS)', imgs: missingDims })
      }
    } catch (e) {
      bugs.push({ id: 'IMG_DIMS_ERR', viewport, title: `img check threw: ${e}` })
    }

    // 5. Primary CTA exists and is tappable
    let ctaExists = false
    try {
      const cta = page.getByRole('button', { name: /Start 7-day Free Trial/i })
      ctaExists = await cta.isVisible()
      if (!ctaExists) {
        bugs.push({ id: 'CTA_MISSING', viewport, title: 'Primary CTA "Start 7-day Free Trial" not visible' })
      }
    } catch (e) {
      bugs.push({ id: 'CTA_ERR', viewport, title: `CTA check threw: ${e}` })
    }

    // 6. Click CTA — verify navigates to /signup
    if (ctaExists) {
      try {
        const cta = page.getByRole('button', { name: /Start 7-day Free Trial/i })
        await cta.click()
        await page.waitForURL('**/signup', { timeout: 5000 })
        const url = page.url()
        if (!url.includes('/signup')) {
          bugs.push({ id: 'CTA_NAV', viewport, title: `CTA did not navigate to /signup; landed on ${url}` })
        }
        // Go back for remaining tests
        await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(500)
      } catch (e) {
        bugs.push({ id: 'CTA_NAV', viewport, title: `CTA click/navigation failed: ${e}` })
        await page.goto('/', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
        await page.waitForTimeout(500)
      }
    }

    // 7. FAQ accordion — open and close
    try {
      const firstFaq = page.locator('button:has-text("Do I need internet")').first()
      const faqVisible = await firstFaq.isVisible()
      if (!faqVisible) {
        bugs.push({ id: 'FAQ_MISSING', viewport, title: 'FAQ first item button not found' })
      } else {
        // Open
        await firstFaq.click()
        await page.waitForTimeout(300)
        const answerText = page.locator('text=ClubKeeper works fully offline')
        const isOpen = await answerText.isVisible()
        if (!isOpen) {
          bugs.push({ id: 'FAQ_OPEN', viewport, title: 'FAQ item does not expand on click', detail: 'Answer text not visible after click' })
        }

        // Close
        await firstFaq.click()
        await page.waitForTimeout(300)
        const isClosed = !(await answerText.isVisible())
        if (!isClosed) {
          bugs.push({ id: 'FAQ_CLOSE', viewport, title: 'FAQ item does not collapse on second click' })
        }
      }
    } catch (e) {
      bugs.push({ id: 'FAQ_ERR', viewport, title: `FAQ accordion test threw: ${e}` })
    }

    // 8. ROI Calculator — updates on input change
    try {
      // Current default: forgetCount=3, ratePerHour=120 → monthly = 3*120*30 = 10800
      const defaultOutput = page.locator('text=/₹10,800/').first()
      const defaultVisible = await defaultOutput.isVisible()
      if (!defaultVisible) {
        bugs.push({ id: 'ROI_DEFAULT', viewport, title: 'ROI calculator default output "₹10,800" not visible' })
      }

      // Click forgetCount=5 → 5*120*30=18000
      const btn5 = page.getByRole('radio', { name: '5' }).first()
      const btn5Visible = await btn5.isVisible()
      if (btn5Visible) {
        await btn5.click()
        await page.waitForTimeout(200)
        const updatedOutput = page.locator('text=/₹18,000/').first()
        const updatedVisible = await updatedOutput.isVisible()
        if (!updatedVisible) {
          // Capture actual text for diagnosis
          const actualText = await page.evaluate(() => {
            const el = document.querySelector('[class*="text-accent"][class*="text-[38px]"]')
            return el ? el.textContent : 'element not found'
          })
          bugs.push({
            id: 'ROI_UPDATE',
            viewport,
            title: 'ROI calculator does not update on forgetCount change',
            detail: `Expected ₹18,000, actual element text: ${actualText}`,
          })
        }
      } else {
        bugs.push({ id: 'ROI_BTN', viewport, title: 'ROI calculator button "5" (times/day) not found' })
      }
    } catch (e) {
      bugs.push({ id: 'ROI_ERR', viewport, title: `ROI calculator test threw: ${e}` })
    }

    // Emit structured output for parsing
    console.log('BUGS_JSON:' + JSON.stringify(bugs))

    // Always pass — this is inventory only
    expect(true).toBe(true)
  })
})
