/**
 * tests/subscribe.spec.ts — Bug inventory for /subscribe
 * Phase 1a: INVENTORY ONLY. No src/ changes.
 *
 * NOTE: /subscribe has an auth guard — unauthenticated visitors are redirected
 * to /signup. We test what's visible before the redirect fires and after
 * we mock the auth store to bypass the guard.
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
          `Button "${(btn.textContent ?? '').trim().slice(0, 40)}" is ${Math.round(r.width)}×${Math.round(r.height)}px`
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

/**
 * Mock Supabase auth + Zustand authStore so /subscribe renders the plans
 * instead of immediately redirecting to /signup.
 *
 * Strategy: inject a fake session into localStorage under Supabase's key
 * before navigation, then override the Zustand store after React mounts.
 */
async function injectMockAuth(page: Page) {
  // Supabase stores session in localStorage under 'sb-<project>-auth-token'
  // We also override the Zustand store after mount via page.evaluate
  await page.addInitScript(() => {
    // Minimal fake Supabase session that satisfies authStore.initialize()
    const fakeSession = {
      access_token: 'fake_access_token_for_testing',
      refresh_token: 'fake_refresh_token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: 'fake-user-id-test',
        email: 'test@clubkeeper.test',
        role: 'authenticated',
        aud: 'authenticated',
        app_metadata: {},
        user_metadata: { full_name: 'Test User', avatar_url: '' },
        created_at: new Date().toISOString(),
      },
    }

    // Try the known Supabase localStorage key pattern
    try {
      localStorage.setItem(
        'sb-vkczmgzujpidbwtzulel-auth-token',
        JSON.stringify(fakeSession)
      )
    } catch (_e) {
      // localStorage not available yet — will be set after
    }

    // Stub window.Razorpay so it doesn't throw
    ;(window as unknown as Record<string, unknown>)['Razorpay'] = class FakeRazorpay {
      constructor(public opts: Record<string, unknown>) {}
      open() { /* no-op */ }
    }
  })
}

/**
 * After page load, override Zustand state to simulate logged-in, no-subscription user.
 */
async function overrideAuthStore(page: Page) {
  await page.evaluate(() => {
    // Attempt to find the Zustand authStore and patch it
    // Zustand stores are globally accessible via import, but in browser we need
    // to reach them through the module system or a global reference.
    // ClubKeeper doesn't expose stores globally, so we patch react-router redirect instead.

    // Override navigate calls to /signup by intercepting history.replaceState
    const origReplace = history.replaceState.bind(history)
    history.replaceState = (state, title, url) => {
      if (typeof url === 'string' && url.includes('/signup')) {
        // Block the redirect to /signup — we're testing /subscribe
        console.log('[test] Blocked redirect to /signup')
        return
      }
      origReplace(state, title, url)
    }

    // Also intercept pushState
    const origPush = history.pushState.bind(history)
    history.pushState = (state, title, url) => {
      if (typeof url === 'string' && url.includes('/signup')) {
        console.log('[test] Blocked pushState to /signup')
        return
      }
      origPush(state, title, url)
    }
  })
}

// ─── tests ────────────────────────────────────────────────────────────────────

test.describe('/subscribe — Plan selection page', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // Inject mock auth before navigation
    await injectMockAuth(page)

    // 1. Navigate to /subscribe
    try {
      await page.goto('/subscribe', { waitUntil: 'domcontentloaded', timeout: 20000 })
    } catch (e) {
      bugs.push({ id: 'LOAD', viewport, title: `Navigation to /subscribe failed: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    // Override auth store to block redirect loop
    await overrideAuthStore(page)
    await page.waitForTimeout(2000)

    // Check where we actually landed
    const landedUrl = page.url()
    const onSubscribe = landedUrl.includes('/subscribe')
    const redirectedToSignup = landedUrl.includes('/signup')

    if (redirectedToSignup) {
      // Auth guard fired immediately — record this as a finding
      bugs.push({
        id: 'AUTH_GUARD_REDIRECT',
        viewport,
        title: '/subscribe immediately redirects unauthenticated visitors to /signup',
        detail: 'Auth guard works correctly (expected behavior), but prevents testing plan UI. Mock auth injection insufficient to bypass Supabase client check.',
        severity: 'info',
      })

      // Test what we can on /signup redirect behavior
      // Page load errors on /signup
      await page.waitForTimeout(500)
      if (errors.length > 0) {
        bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors during /subscribe → /signup redirect', errors: [...errors] })
      }

      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    if (!onSubscribe) {
      bugs.push({ id: 'WRONG_URL', viewport, title: `Landed on unexpected URL: ${landedUrl}` })
    }

    // 1b. Console errors check
    if (errors.length > 0) {
      bugs.push({ id: 'CONSOLE', viewport, title: 'Console errors on /subscribe load', errors: [...errors] })
    }

    // 2. No horizontal overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) {
        bugs.push({ id: 'OVERFLOW', viewport, title: 'Horizontal body overflow on /subscribe', detail: overflow })
      }
    } catch (e) {
      bugs.push({ id: 'OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` })
    }

    // 3. Button touch targets (mobile-360 only)
    if (viewport === 'mobile-360') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) {
          bugs.push({ id: 'TOUCH', viewport, title: 'Buttons < 44×44px on /subscribe', buttons: small })
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

    // 5 & 6. Billing toggle — Monthly/Annual switch
    try {
      const monthlyTab = page.getByRole('tab', { name: /monthly/i }).first()
      const annualTab = page.getByRole('tab', { name: /annual/i }).first()
      const monthlyVisible = await monthlyTab.isVisible()
      const annualVisible = await annualTab.isVisible()

      if (!monthlyVisible || !annualVisible) {
        bugs.push({
          id: 'BILLING_TOGGLE',
          viewport,
          title: 'Billing toggle tabs not visible',
          detail: `Monthly: ${monthlyVisible}, Annual: ${annualVisible}`,
        })
      } else {
        // Monthly should be selected by default
        const monthlySelected = await monthlyTab.getAttribute('aria-selected')
        if (monthlySelected !== 'true') {
          bugs.push({ id: 'BILLING_DEFAULT', viewport, title: 'Monthly billing not selected by default', detail: `aria-selected="${monthlySelected}"` })
        }

        // Click Annual
        await annualTab.click()
        await page.waitForTimeout(300)
        const annualSelected = await annualTab.getAttribute('aria-selected')
        if (annualSelected !== 'true') {
          bugs.push({ id: 'BILLING_SWITCH_ANNUAL', viewport, title: 'Annual tab not activated after click' })
        }

        // Verify "save 2 mo" badge visible on annual
        const saveBadge = page.locator('text=save 2 mo').first()
        const badgeVisible = await saveBadge.isVisible()
        if (!badgeVisible) {
          bugs.push({ id: 'BILLING_BADGE', viewport, title: '"save 2 mo" badge not visible on Annual tab' })
        }

        // Switch back to Monthly
        await monthlyTab.click()
        await page.waitForTimeout(300)
      }
    } catch (e) {
      bugs.push({ id: 'BILLING_ERR', viewport, title: `Billing toggle test threw: ${e}` })
    }

    // 7. Plan cards visible — Standard should be featured
    try {
      const starterCard = page.locator('text=Starter').first()
      const standardCard = page.locator('text=Standard').first()
      const starterVisible = await starterCard.isVisible()
      const standardVisible = await standardCard.isVisible()

      if (!starterVisible) {
        bugs.push({ id: 'PLAN_STARTER', viewport, title: 'Starter plan card not visible' })
      }
      if (!standardVisible) {
        bugs.push({ id: 'PLAN_STANDARD', viewport, title: 'Standard plan card not visible' })
      }
    } catch (e) {
      bugs.push({ id: 'PLAN_CARDS_ERR', viewport, title: `Plan cards check threw: ${e}` })
    }

    // 8. Primary CTA — sticky checkout bar visible and clickable
    let checkoutBarVisible = false
    try {
      // StickyCheckout bar renders a CTA button
      const checkoutBtn = page.locator('button').filter({ hasText: /Start.*Trial|Choose.*Plan|Select.*Plan|Continue/i }).first()
      checkoutBarVisible = await checkoutBtn.isVisible()
      if (!checkoutBarVisible) {
        bugs.push({ id: 'CHECKOUT_BAR', viewport, title: 'Sticky checkout CTA button not visible' })
      }
    } catch (e) {
      bugs.push({ id: 'CHECKOUT_BAR_ERR', viewport, title: `Checkout bar check threw: ${e}` })
    }

    // 9. Payment bottom sheet — opens when CTA is clicked, closes on X
    try {
      // Find the sticky checkout button
      const checkoutBtn = page.locator('button').filter({ hasText: /Start.*Trial|Choose.*Plan|Select.*Plan|Continue/i }).first()
      const ctaVisible = await checkoutBtn.isVisible()
      if (!ctaVisible) {
        bugs.push({ id: 'PAYMENT_SHEET_PREREQ', viewport, title: 'Cannot test payment sheet — checkout CTA not visible' })
      } else {
        await checkoutBtn.click()
        await page.waitForTimeout(500)

        // Sheet should have a dialog role and "Start Your 7-Day Trial" heading
        const sheet = page.locator('[role="dialog"]').first()
        const sheetVisible = await sheet.isVisible()
        if (!sheetVisible) {
          bugs.push({ id: 'PAYMENT_SHEET_OPEN', viewport, title: 'Payment bottom sheet did not open after CTA click' })
        } else {
          // Verify sheet heading
          const sheetHeading = page.locator('text=Start Your 7-Day Trial').first()
          const headingVisible = await sheetHeading.isVisible()
          if (!headingVisible) {
            bugs.push({ id: 'PAYMENT_SHEET_HEADING', viewport, title: 'Payment sheet heading "Start Your 7-Day Trial" not visible' })
          }

          // Verify UPI method visible by default
          const upiText = page.locator('text=UPI').first()
          const upiVisible = await upiText.isVisible()
          if (!upiVisible) {
            bugs.push({ id: 'PAYMENT_UPI', viewport, title: 'UPI payment method not visible inside bottom sheet' })
          }

          // Close sheet via X button
          const closeBtn = page.locator('[role="dialog"] button').filter({
            has: page.locator('svg line'),
          }).first()
          const closeVisible = await closeBtn.isVisible()
          if (!closeVisible) {
            bugs.push({ id: 'PAYMENT_SHEET_CLOSE', viewport, title: 'Payment sheet close (X) button not found' })
          } else {
            await closeBtn.click()
            await page.waitForTimeout(500)
            const sheetGone = !(await sheet.isVisible())
            if (!sheetGone) {
              bugs.push({ id: 'PAYMENT_SHEET_CLOSE_FAIL', viewport, title: 'Payment sheet did not close after X button click' })
            }
          }
        }
      }
    } catch (e) {
      bugs.push({ id: 'PAYMENT_SHEET_ERR', viewport, title: `Payment sheet test threw: ${e}` })
    }

    // 10. Progress steps visible
    try {
      const signUpStep = page.locator('text=Sign up').first()
      const choosePlanStep = page.locator('text=Choose plan').first()
      const payStep = page.locator('text=Pay').first()
      const allVisible = await Promise.all([
        signUpStep.isVisible(),
        choosePlanStep.isVisible(),
        payStep.isVisible(),
      ])
      if (!allVisible.every(Boolean)) {
        bugs.push({
          id: 'PROGRESS_STEPS',
          viewport,
          title: 'Progress steps not all visible',
          detail: `Sign up: ${allVisible[0]}, Choose plan: ${allVisible[1]}, Pay: ${allVisible[2]}`,
        })
      }
    } catch (e) {
      bugs.push({ id: 'PROGRESS_STEPS_ERR', viewport, title: `Progress steps check threw: ${e}` })
    }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
