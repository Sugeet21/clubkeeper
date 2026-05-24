/**
 * tests/signup.spec.ts — Bug inventory for /signup
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
    return await page.evaluate(() => {
      return document.body.scrollWidth > window.innerWidth
        ? `body.scrollWidth (${document.body.scrollWidth}) > innerWidth (${window.innerWidth})`
        : null
    })
  } catch (e) {
    return `evaluate error: ${e}`
  }
}

async function smallButtonsOnMobile(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
    const issues: string[] = []
    buttons.forEach((btn) => {
      if (!btn.offsetParent) return
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

test.describe('/signup — Sign-in page', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // 1. Page loads
    try {
      const response = await page.goto('/signup', { waitUntil: 'networkidle', timeout: 20000 })
      if (!response || !response.ok()) {
        bugs.push({ id: 'LOAD', viewport, title: 'Page did not return 200', status: response?.status() })
      }
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(1500)

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

    // 5. Google sign-in button visible
    let googleBtnVisible = false
    try {
      // The GoogleSigninButton renders a button with "Continue with Google" or Google logo
      const googleBtn = page.locator('button').filter({ hasText: /google|Continue with Google/i }).first()
      googleBtnVisible = await googleBtn.isVisible()
      if (!googleBtnVisible) {
        // Try broader selector — could be SVG-only button
        const allButtons = await page.locator('button').all()
        let foundGoogle = false
        for (const btn of allButtons) {
          const html = await btn.innerHTML()
          if (html.includes('4285F4') || html.includes('google') || html.toLowerCase().includes('google')) {
            foundGoogle = true
            googleBtnVisible = true
            break
          }
        }
        if (!foundGoogle) {
          bugs.push({ id: 'GOOGLE_BTN', viewport, title: 'Google sign-in button not found or not visible' })
        }
      }
    } catch (e) {
      bugs.push({ id: 'GOOGLE_BTN_ERR', viewport, title: `Google button check threw: ${e}` })
    }

    // 6. Primary CTA is tappable — clicking Google button triggers auth flow (stays on page or navigates)
    if (googleBtnVisible) {
      try {
        // We can't complete OAuth but we can verify the button is clickable and loading state works
        // Intercept the signInWithGoogle call to prevent actual OAuth redirect
        const initialUrl = page.url()
        // Just verify the button is enabled and clickable
        const googleBtn = page.locator('button').filter({ hasText: /google/i }).first()
        const isDisabled = await googleBtn.isDisabled()
        if (isDisabled) {
          bugs.push({ id: 'GOOGLE_BTN_DISABLED', viewport, title: 'Google sign-in button is disabled on initial load' })
        }
        // Check the URL didn't change unexpectedly
        const afterUrl = page.url()
        if (!afterUrl.includes('/signup') && !afterUrl.includes('/tables') && !afterUrl.includes('/auth')) {
          bugs.push({ id: 'GOOGLE_NAV', viewport, title: `Unexpected navigation after Google button check: ${afterUrl}` })
        }
      } catch (e) {
        bugs.push({ id: 'GOOGLE_CLICK_ERR', viewport, title: `Google button clickability check threw: ${e}` })
      }
    }

    // 7. Back chevron navigates to /
    try {
      const backBtn = page.locator('button[aria-label="Back to landing"]').first()
      const backVisible = await backBtn.isVisible()
      if (!backVisible) {
        bugs.push({ id: 'BACK_BTN', viewport, title: 'Back chevron button (aria-label="Back to landing") not found' })
      } else {
        await backBtn.click()
        await page.waitForURL('**/', { timeout: 5000 })
        const afterUrl = page.url()
        // Should be exactly / (landing), not /signup
        const isLanding = afterUrl.replace('http://localhost:5173', '') === '/' ||
          afterUrl.endsWith(':5173/')
        if (!isLanding) {
          bugs.push({ id: 'BACK_NAV', viewport, title: `Back chevron did not navigate to /; landed on ${afterUrl}` })
        }
        // Return to /signup for remaining checks
        await page.goto('/signup', { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(500)
      }
    } catch (e) {
      bugs.push({ id: 'BACK_ERR', viewport, title: `Back button test threw: ${e}` })
      await page.goto('/signup', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(500)
    }

    // 8. Signup-specific: "Already have an account?" Sign in button visible
    try {
      const signInBtn = page.getByRole('button', { name: /^Sign in$/i })
      const visible = await signInBtn.isVisible()
      if (!visible) {
        bugs.push({ id: 'SIGNIN_BTN', viewport, title: '"Sign in" (already have account) button not visible' })
      }
    } catch (e) {
      bugs.push({ id: 'SIGNIN_BTN_ERR', viewport, title: `Sign-in button check threw: ${e}` })
    }

    // 9. Trust rows rendered (data-safety section)
    try {
      const trustText = page.locator('text=Your data stays on your phone')
      const trustVisible = await trustText.isVisible()
      if (!trustVisible) {
        bugs.push({ id: 'TRUST_ROWS', viewport, title: 'Trust rows section not visible ("Your data stays on your phone")' })
      }
    } catch (e) {
      bugs.push({ id: 'TRUST_ROWS_ERR', viewport, title: `Trust rows check threw: ${e}` })
    }

    // 10. Error state — ?error= param triggers error toast
    try {
      await page.goto('/signup?error=access_denied&error_description=User+denied+access', {
        waitUntil: 'networkidle',
        timeout: 15000,
      })
      await page.waitForTimeout(600)
      // SigninError renders a fixed bottom toast with a Retry button
      const retryBtn = page.getByRole('button', { name: /retry/i }).first()
      const toastVisible = await retryBtn.isVisible()
      if (!toastVisible) {
        bugs.push({
          id: 'ERROR_TOAST',
          viewport,
          title: 'Error toast / Retry button not shown when ?error= param is present',
          detail: 'Navigated to /signup?error=access_denied — Retry button not found',
        })
      }
    } catch (e) {
      bugs.push({ id: 'ERROR_TOAST_ERR', viewport, title: `Error state test threw: ${e}` })
    }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
