#!/usr/bin/env node
/**
 * sync-state.mjs — regenerates STATE.md's open-issues block from GitHub
 * (skill-redesign Phase 6). Also refreshes the "Last verified" stamp.
 *
 * Usage: node scripts/sync-state.mjs      (requires `gh` authenticated)
 * The block between <!-- ISSUES:BEGIN --> and <!-- ISSUES:END --> is owned by
 * this script; hand-notes belong ABOVE the markers. `npm run check:skill`
 * still independently verifies every open P0/P1 appears in the file.
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STATE = join(import.meta.dirname, '..', '.claude', 'skills', 'clubkeeper', 'STATE.md')

const issues = JSON.parse(execSync(
  'gh issue list --state open --repo Sugeet21/clubkeeper --json number,title,labels --limit 200',
  { encoding: 'utf8', timeout: 30000 }
))

const prio = (i) => {
  const l = i.labels.map((x) => x.name.toUpperCase())
  if (l.includes('P0')) return 'P0'
  if (l.includes('P1')) return 'P1'
  return 'P2'
}
const short = (t) => t.replace(/^(BUG|SYNC|ENH|FEAT)[-A-Z0-9]*\s*[—-]\s*/i, '').slice(0, 70).trim()
const by = { P0: [], P1: [], P2: [] }
for (const i of issues.sort((a, b) => a.number - b.number)) by[prio(i)].push(i)

const block = [
  `**P0:** ${by.P0.map((i) => `#${i.number} ${short(i.title)}`).join(' · ') || 'none'}.`,
  `**P1:** ${by.P1.map((i) => `#${i.number} ${short(i.title)}`).join(' · ') || 'none'}.`,
  `**P2 / unlabelled:** ${by.P2.map((i) => `#${i.number}`).join(' ') || 'none'}.`,
].join('\n')

let t = readFileSync(STATE, 'utf8')
const re = /(<!-- ISSUES:BEGIN[^>]*-->)[\s\S]*?(<!-- ISSUES:END -->)/
if (!re.test(t)) { console.error('ISSUES markers not found in STATE.md'); process.exit(1) }
t = t.replace(re, `$1\n${block}\n$2`)

// refresh the Last verified stamp (date only; keep the parenthetical)
const now = new Date()
const stamp = `${now.getDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getMonth()]} ${now.getFullYear()}`
t = t.replace(/Last verified: \d{1,2} [A-Z][a-z]{2} \d{4}/, `Last verified: ${stamp}`)

writeFileSync(STATE, t)
console.log(`STATE.md issues block regenerated: ${by.P0.length} P0, ${by.P1.length} P1, ${by.P2.length} P2/other. Stamp: ${stamp}`)
