import { test, expect } from '@playwright/test'
import fs from 'fs'

test('auth state exists', () => {
  expect(fs.existsSync('.auth/user.json')).toBe(true)
})
