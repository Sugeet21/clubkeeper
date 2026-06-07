import { defineConfig } from '@playwright/test'

const AUTH_FILE = '.auth/user.json'

export default defineConfig({
  testDir: './tests',
  reporter: 'list',
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    // ── Auth setup (run once, headed, before protected-route tests) ──
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
      use: {
        // Headed so user can interact with Google OAuth
        headless: false,
      },
    },

    // ── Public-route projects (Phase 1a — no auth needed) ────────────
    {
      name: 'mobile-360',
      testMatch: ['**/landing.spec.ts', '**/signup.spec.ts', '**/subscribe.spec.ts'],
      use: {
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'tablet-768',
      testMatch: ['**/landing.spec.ts', '**/signup.spec.ts', '**/subscribe.spec.ts'],
      use: {
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'desktop-1280',
      testMatch: ['**/landing.spec.ts', '**/signup.spec.ts', '**/subscribe.spec.ts'],
      use: {
        viewport: { width: 1280, height: 800 },
      },
    },

    // ── Protected-route projects (Phase 1b — auth required) ───────────
    {
      name: 'mobile-360-auth',
      testMatch: ['**/tables.spec.ts', '**/session.spec.ts', '**/history.spec.ts', '**/settings.spec.ts', '**/canteen-calculations.spec.ts'],
      dependencies: ['setup'],
      use: {
        viewport: { width: 360, height: 800 },
        deviceScaleFactor: 2,
        storageState: AUTH_FILE,
        acceptDownloads: true,
      },
    },
    {
      name: 'tablet-768-auth',
      testMatch: ['**/tables.spec.ts', '**/session.spec.ts', '**/history.spec.ts', '**/settings.spec.ts', '**/canteen-calculations.spec.ts'],
      dependencies: ['setup'],
      use: {
        viewport: { width: 768, height: 1024 },
        storageState: AUTH_FILE,
        acceptDownloads: true,
      },
    },
    {
      name: 'desktop-1280-auth',
      testMatch: ['**/tables.spec.ts', '**/session.spec.ts', '**/history.spec.ts', '**/settings.spec.ts', '**/canteen-calculations.spec.ts'],
      dependencies: ['setup'],
      use: {
        viewport: { width: 1280, height: 800 },
        storageState: AUTH_FILE,
        acceptDownloads: true,
      },
    },
  ],
})
