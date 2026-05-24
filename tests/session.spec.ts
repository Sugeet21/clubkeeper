/**
 * tests/session.spec.ts — Bug inventory for /start/:tableId and /session/:sessionId
 * Phase 1b: INVENTORY ONLY. No src/ changes.
 *
 * Strategy: navigate to /tables first, pick a real table ID from DOM,
 * then navigate to /start/:id. After starting a session, land on /session/:id.
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

test.describe('/start/:tableId and /session/:sessionId — Session flow', () => {
  test('all checks', async ({ page }, testInfo) => {
    const viewport = testInfo.project.name
    const bugs: Record<string, unknown>[] = []
    const errors = collectErrors(page)

    // Navigate to /tables to find a real table ID
    try {
      await page.goto('/tables', { waitUntil: 'networkidle', timeout: 20000 })
    } catch (e) {
      bugs.push({ id: 'LOAD_TABLES', viewport, title: `Cannot load /tables: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(2000)
    const tablesUrl = page.url()

    if (!tablesUrl.includes('/tables')) {
      bugs.push({
        id: 'AUTH_REDIRECT',
        viewport,
        title: `/tables redirected to ${tablesUrl} — cannot test session flow`,
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // Extract table IDs from navigation links to /start/:id
    let tableId: string | null = null
    try {
      tableId = await page.evaluate(() => {
        // TableCard renders a button with onClick={() => navigate(`/start/${table.id}`)}
        // We can find it by looking at the React event handlers — instead, check
        // the data stored in IndexedDB via a query
        // Fallback: try to find a "Start" or table card button and extract ID from onclick
        const cards = Array.from(document.querySelectorAll('[class*="rounded"][class*="border"]'))
        for (const card of cards) {
          // Look for the ▶ Start button text inside cards
          if (card.textContent?.includes('▶') || card.textContent?.includes('Start')) {
            const btn = card.querySelector('button')
            if (btn) return 'found_via_card'
          }
        }
        return null
      })
    } catch (_e) {
      tableId = null
    }

    // Try to get table ID from IndexedDB directly
    let realTableId: number | null = null
    try {
      realTableId = await page.evaluate(async () => {
        return new Promise<number | null>((resolve) => {
          const req = indexedDB.open('ClubKeeperDB')
          req.onsuccess = () => {
            const db = req.result
            if (!db.objectStoreNames.contains('gameTables')) { resolve(null); return }
            const tx = db.transaction('gameTables', 'readonly')
            const store = tx.objectStore('gameTables')
            const getAllReq = store.getAll()
            getAllReq.onsuccess = () => {
              const tables = getAllReq.result as Array<{ id?: number; outOfService?: boolean }>
              const active = tables.find((t) => !t.outOfService && t.id)
              resolve(active?.id ?? null)
            }
            getAllReq.onerror = () => resolve(null)
          }
          req.onerror = () => resolve(null)
        })
      })
    } catch (_e) {
      realTableId = null
    }

    if (!realTableId) {
      bugs.push({
        id: 'NO_TABLE_FOR_SESSION',
        viewport,
        title: 'No active table found in IndexedDB — cannot test /start/:id flow',
        detail: 'User needs at least one active table to test session flow. Run the test after adding a table via Settings.',
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // ── /start/:tableId checks ──────────────────────────────────────────

    try {
      await page.goto(`/start/${realTableId}`, { waitUntil: 'networkidle', timeout: 15000 })
    } catch (e) {
      bugs.push({ id: 'START_LOAD', viewport, title: `/start/${realTableId} failed to load: ${e}` })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      return
    }

    await page.waitForTimeout(1000)

    // Console errors on /start
    if (errors.length > 0) {
      bugs.push({ id: 'START_CONSOLE', viewport, title: `Console errors on /start/${realTableId}`, errors: [...errors] })
    }

    // Overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) bugs.push({ id: 'START_OVERFLOW', viewport, title: `Horizontal overflow on /start/${realTableId}`, detail: overflow })
    } catch (e) { bugs.push({ id: 'START_OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` }) }

    // Touch targets (mobile)
    if (viewport === 'mobile-360-auth') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) bugs.push({ id: 'START_TOUCH', viewport, title: `Buttons < 44×44px on /start/${realTableId}`, buttons: small })
      } catch (e) { bugs.push({ id: 'START_TOUCH_ERR', viewport, title: `Touch check threw: ${e}` }) }
    }

    // img dimensions
    try {
      const imgs = await imgsWithoutDimensions(page)
      if (imgs.length > 0) bugs.push({ id: 'START_IMG', viewport, title: '<img> missing dimensions on /start/:id', imgs })
    } catch (e) { bugs.push({ id: 'START_IMG_ERR', viewport, title: `img check threw: ${e}` }) }

    // "Start Timer Now" button visible
    try {
      const startBtn = page.getByRole('button', { name: /Start Timer Now/i })
      const startVisible = await startBtn.isVisible()
      if (!startVisible) {
        bugs.push({ id: 'START_BTN_MISSING', viewport, title: '"▶ Start Timer Now" button not visible on /start/:id' })
      } else {
        // Check it's not disabled
        const isDisabled = await startBtn.isDisabled()
        if (isDisabled) {
          bugs.push({ id: 'START_BTN_DISABLED', viewport, title: '"Start Timer Now" button is disabled on load (should be enabled)' })
        }
      }
    } catch (e) { bugs.push({ id: 'START_BTN_ERR', viewport, title: `Start button check threw: ${e}` }) }

    // Player name validation — 50+ char input
    try {
      const nameInput = page.locator('input[placeholder="Enter name…"]')
      const inputVisible = await nameInput.isVisible()
      if (!inputVisible) {
        bugs.push({ id: 'START_NAME_INPUT', viewport, title: 'Player name input not found on /start/:id' })
      } else {
        // Type 51 chars — should show validation error
        const longName = 'A'.repeat(51)
        await nameInput.fill(longName)
        await page.waitForTimeout(200)

        const errorMsg = page.locator('text=/50 characters|too long|max/i').first()
        const hasError = await errorMsg.isVisible()
        if (!hasError) {
          bugs.push({
            id: 'START_NAME_VALIDATION',
            viewport,
            title: 'No validation error shown for 51-char player name',
            detail: 'Expected error message about 50 character limit',
          })
        }

        // Clear field
        await nameInput.fill('')
        await page.waitForTimeout(200)
      }
    } catch (e) { bugs.push({ id: 'START_VALIDATION_ERR', viewport, title: `Name validation check threw: ${e}` }) }

    // Player count stepper — decrement below 1 guard
    try {
      const minusBtn = page.locator('button:has-text("−")').first()
      const minusVisible = await minusBtn.isVisible()
      if (!minusVisible) {
        bugs.push({ id: 'START_STEPPER', viewport, title: 'Player count − button not found' })
      } else {
        // Default is 2. Click minus multiple times and verify it doesn't go below 1
        await minusBtn.click()
        await minusBtn.click()
        await minusBtn.click()
        await page.waitForTimeout(200)
        const countInput = page.locator('input[inputmode="numeric"]').first()
        const value = await countInput.inputValue()
        if (parseInt(value) < 1) {
          bugs.push({ id: 'START_STEPPER_MIN', viewport, title: `Player count went below 1: got ${value}` })
        }
      }
    } catch (e) { bugs.push({ id: 'START_STEPPER_ERR', viewport, title: `Stepper check threw: ${e}` }) }

    // Click "Start Timer Now" and verify navigation to /session/:id
    let sessionId: string | null = null
    try {
      const startBtn = page.getByRole('button', { name: /Start Timer Now/i })
      const isVisible = await startBtn.isVisible()
      const isDisabled = await startBtn.isDisabled()

      if (isVisible && !isDisabled) {
        await startBtn.click()
        await page.waitForURL('**/session/**', { timeout: 10000 })
        const sessionUrl = page.url()
        const match = sessionUrl.match(/\/session\/(\d+)/)
        sessionId = match ? match[1] : null

        if (!sessionUrl.includes('/session/')) {
          bugs.push({ id: 'START_NAV', viewport, title: 'After clicking "Start Timer Now", did not navigate to /session/:id', url: sessionUrl })
        }
      } else {
        bugs.push({ id: 'START_BTN_CANT_CLICK', viewport, title: 'Start Timer Now button not clickable — skipping session flow checks' })
      }
    } catch (e) {
      bugs.push({ id: 'START_CLICK_ERR', viewport, title: `Start Timer Now click threw: ${e}` })
    }

    // ── /session/:sessionId checks ─────────────────────────────────────

    if (!sessionId) {
      // Try to find any existing session in IndexedDB
      try {
        const existingSessionId = await page.evaluate(async () => {
          return new Promise<number | null>((resolve) => {
            const req = indexedDB.open('ClubKeeperDB')
            req.onsuccess = () => {
              const db = req.result
              if (!db.objectStoreNames.contains('sessions')) { resolve(null); return }
              const tx = db.transaction('sessions', 'readonly')
              const store = tx.objectStore('sessions')
              const getAllReq = store.getAll()
              getAllReq.onsuccess = () => {
                const sessions = getAllReq.result as Array<{ id?: number; status?: string }>
                const active = sessions.find((s) => s.status === 'running' || s.status === 'paused')
                resolve(active?.id ?? sessions[0]?.id ?? null)
              }
              getAllReq.onerror = () => resolve(null)
            }
            req.onerror = () => resolve(null)
          })
        })
        if (existingSessionId) sessionId = String(existingSessionId)
      } catch (_e) {}
    }

    if (!sessionId) {
      bugs.push({
        id: 'SESSION_NO_ID',
        viewport,
        title: 'Cannot test /session/:id — no session created and none found in IndexedDB',
        severity: 'info',
      })
      console.log('BUGS_JSON:' + JSON.stringify(bugs))
      expect(true).toBe(true)
      return
    }

    // Navigate to session if not already there
    const currentUrl = page.url()
    if (!currentUrl.includes(`/session/${sessionId}`)) {
      try {
        await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle', timeout: 15000 })
        await page.waitForTimeout(1000)
      } catch (e) {
        bugs.push({ id: 'SESSION_LOAD', viewport, title: `/session/${sessionId} failed to load: ${e}` })
        console.log('BUGS_JSON:' + JSON.stringify(bugs))
        return
      }
    }

    await page.waitForTimeout(1000)

    // Console errors on /session
    const postSessionErrors = errors.filter((e) => !e.includes('401'))
    if (postSessionErrors.length > 0) {
      bugs.push({ id: 'SESSION_CONSOLE', viewport, title: `Console errors on /session/${sessionId}`, errors: postSessionErrors })
    }

    // Overflow
    try {
      const overflow = await noHorizontalOverflow(page)
      if (overflow) bugs.push({ id: 'SESSION_OVERFLOW', viewport, title: 'Horizontal overflow on /session/:id', detail: overflow })
    } catch (e) { bugs.push({ id: 'SESSION_OVERFLOW_ERR', viewport, title: `Overflow check threw: ${e}` }) }

    // Touch targets (mobile)
    if (viewport === 'mobile-360-auth') {
      try {
        const small = await smallButtonsOnMobile(page)
        if (small.length > 0) bugs.push({ id: 'SESSION_TOUCH', viewport, title: 'Buttons < 44×44px on /session/:id', buttons: small })
      } catch (e) { bugs.push({ id: 'SESSION_TOUCH_ERR', viewport, title: `Touch check threw: ${e}` }) }
    }

    // img dimensions
    try {
      const imgs = await imgsWithoutDimensions(page)
      if (imgs.length > 0) bugs.push({ id: 'SESSION_IMG', viewport, title: '<img> missing dimensions on /session/:id', imgs })
    } catch (e) { bugs.push({ id: 'SESSION_IMG_ERR', viewport, title: `img check threw: ${e}` }) }

    // Timer display — HH:MM:SS format visible
    try {
      const timer = page.locator('text=/\\d{2}:\\d{2}/').first()
      const timerVisible = await timer.isVisible()
      if (!timerVisible) {
        bugs.push({ id: 'SESSION_TIMER', viewport, title: 'Timer display (HH:MM format) not visible on /session/:id' })
      }
    } catch (e) { bugs.push({ id: 'SESSION_TIMER_ERR', viewport, title: `Timer check threw: ${e}` }) }

    // Check session status and test Pause/Resume if running
    try {
      const pauseBtn = page.getByRole('button', { name: /Pause/i })
      const resumeBtn = page.getByRole('button', { name: /Resume/i })
      const isPausing = await pauseBtn.isVisible()
      const isResuming = await resumeBtn.isVisible()

      if (isPausing) {
        // Currently running — test pause
        await pauseBtn.click()
        await page.waitForTimeout(1000)
        const resumeAfterPause = page.getByRole('button', { name: /Resume/i })
        const resumeVisible = await resumeAfterPause.isVisible()
        if (!resumeVisible) {
          bugs.push({ id: 'SESSION_PAUSE', viewport, title: 'After clicking Pause, Resume button not visible' })
        } else {
          // Resume
          await resumeAfterPause.click()
          await page.waitForTimeout(1000)
          const pauseAfterResume = page.getByRole('button', { name: /Pause/i })
          const pauseVisible = await pauseAfterResume.isVisible()
          if (!pauseVisible) {
            bugs.push({ id: 'SESSION_RESUME', viewport, title: 'After clicking Resume, Pause button not visible' })
          }
        }
      } else if (!isResuming) {
        // Session may be completed — check for "Back to Home" button
        const backBtn = page.getByRole('button', { name: /Back to Home/i })
        const backVisible = await backBtn.isVisible()
        if (!backVisible) {
          bugs.push({ id: 'SESSION_NO_ACTIONS', viewport, title: 'No Pause, Resume, or Back to Home button on /session/:id' })
        }
      }
    } catch (e) { bugs.push({ id: 'SESSION_ACTIONS_ERR', viewport, title: `Pause/Resume check threw: ${e}` }) }

    // Stop session — opens confirm modal
    try {
      const stopBtn = page.getByRole('button', { name: /Stop Session/i })
      const stopVisible = await stopBtn.isVisible()
      if (!stopVisible) {
        bugs.push({ id: 'SESSION_STOP_MISSING', viewport, title: 'Stop Session button not visible (session may already be completed)' })
      } else {
        await stopBtn.click()
        await page.waitForTimeout(500)

        // Confirm modal should appear
        const confirmModal = page.locator('text=End this session?').first()
        const modalVisible = await confirmModal.isVisible()
        if (!modalVisible) {
          bugs.push({ id: 'SESSION_STOP_MODAL', viewport, title: 'Stop confirm modal did not appear after clicking Stop Session' })
        } else {
          // Click "Yes, End Session"
          const endBtn = page.getByRole('button', { name: /Yes, End Session/i })
          const endVisible = await endBtn.isVisible()
          if (!endVisible) {
            bugs.push({ id: 'SESSION_STOP_CONFIRM_BTN', viewport, title: '"Yes, End Session" button not found in stop modal' })
          } else {
            await endBtn.click()
            await page.waitForTimeout(2000)
            // BUG CHECK: handleStop() calls navigate('/', ...) instead of navigate('/tables', ...)
            const afterStopUrl = page.url()
            if (afterStopUrl.endsWith(':5173/') || afterStopUrl.replace('http://localhost:5173', '') === '/') {
              bugs.push({
                id: 'SESSION_STOP_WRONG_NAV',
                viewport,
                title: 'Stop session navigates to / (Landing) instead of /tables',
                detail: `URL after stop: ${afterStopUrl}. Found in SessionDetail.tsx:200 — navigate('/', { replace: true }) should be navigate('/tables', { replace: true })`,
                suspectedFile: 'src/pages/SessionDetail.tsx:200',
              })
            } else if (!afterStopUrl.includes('/tables') && !afterStopUrl.includes('/history') && !afterStopUrl.includes('/session')) {
              bugs.push({ id: 'SESSION_STOP_NAV_UNKNOWN', viewport, title: `Stop session navigated to unexpected URL: ${afterStopUrl}` })
            }
          }
        }
      }
    } catch (e) { bugs.push({ id: 'SESSION_STOP_ERR', viewport, title: `Stop session check threw: ${e}` }) }

    // "Running Total" amount formatting
    try {
      await page.goto(`/session/${sessionId}`, { waitUntil: 'networkidle', timeout: 10000 })
      await page.waitForTimeout(500)
      const amountEl = page.locator('text=/₹\\d+/').first()
      const amountVisible = await amountEl.isVisible()
      if (!amountVisible) {
        bugs.push({ id: 'SESSION_AMOUNT', viewport, title: 'Running Total amount (₹X) not visible on /session/:id' })
      } else {
        // Check it uses correct format
        const amountText = await amountEl.textContent()
        if (amountText && !amountText.includes('₹')) {
          bugs.push({ id: 'SESSION_AMOUNT_FORMAT', viewport, title: `Amount display missing ₹ symbol: "${amountText}"` })
        }
      }
    } catch (e) { bugs.push({ id: 'SESSION_AMOUNT_ERR', viewport, title: `Amount format check threw: ${e}` }) }

    console.log('BUGS_JSON:' + JSON.stringify(bugs))
    expect(true).toBe(true)
  })
})
