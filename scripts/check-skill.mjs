#!/usr/bin/env node
/**
 * check-skill.mjs — deterministic skill-consistency gate (skill-redesign Phase 4).
 *
 * Machine-enforces the mechanically-checkable halves of Rules B and G plus the
 * integrity guarantees the redesign introduced. The clubkeeper-skill-auditor
 * agent runs this FIRST, then does the judgment-only checks a script can't.
 *
 * Usage:  node scripts/check-skill.mjs [--since "<git date>"]   (default: "4 hours ago")
 * Exit 0 = all checks pass (warnings allowed). Exit 1 = at least one FAIL.
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SKILL_DIR = join(ROOT, '.claude', 'skills', 'clubkeeper')
const REF = (f) => join(SKILL_DIR, 'references', f)
const sinceArg = process.argv.indexOf('--since')
const SINCE = sinceArg > -1 ? process.argv[sinceArg + 1] : '4 hours ago'

const failures = []
const warnings = []
const ok = (msg) => console.log(`  \x1b[32mPASS\x1b[0m ${msg}`)
const fail = (msg) => { failures.push(msg); console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`) }
const warn = (msg) => { warnings.push(msg); console.log(`  \x1b[33mWARN\x1b[0m ${msg}`) }
const read = (p) => readFileSync(p, 'utf8')
const git = (cmd) => execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' })

// Resolve the changelog/bug_archive location (works before AND after the Phase 5 history/ move)
const HISTORY_AWARE = (name) => {
  const inHistory = join(SKILL_DIR, 'references', 'history', name)
  return existsSync(inHistory) ? inHistory : REF(name)
}

// ── 1. Rule B — paired commits ────────────────────────────────────────────────
console.log(`\n[1] Rule B — src/api/migration commits paired with skill commits (since "${SINCE}")`)
try {
  const log = git(`log --since="${SINCE}" --name-only --pretty=format:"@@%h %s"`)
  const commits = log.split('@@').filter(Boolean).map((block) => {
    const [head, ...files] = block.trim().split('\n')
    return { head, files: files.filter(Boolean) }
  })
  const touchesCode = (f) => /^(src|api|supabase\/migrations)\//.test(f)
  const touchesSkill = (f) => /^\.claude\/skills\/clubkeeper\//.test(f)
  const codeCommits = commits.filter((c) => c.files.some(touchesCode))
  const skillTouchedInWindow = commits.some((c) => c.files.some(touchesSkill))
  if (codeCommits.length === 0) ok('no code commits in window')
  else if (skillTouchedInWindow) ok(`${codeCommits.length} code commit(s), skill files also updated in window`)
  else fail(`code commits without ANY skill update in window: ${codeCommits.map((c) => c.head).join('; ')}`)
} catch (e) { warn(`git log failed (${String(e).slice(0, 80)}) — skipping Rule B check`) }

// ── 2. Rule G — STATE.md shape ───────────────────────────────────────────────
console.log('\n[2] Rule G — STATE.md shape (one line per module, no SHAs/sizes/dates in status lines)')
const statePath = join(SKILL_DIR, 'STATE.md')
if (!existsSync(statePath)) fail('STATE.md missing')
else {
  const state = read(statePath)
  const section = state.split(/^## Module status.*$/m)[1]?.split(/^## /m)[0] ?? ''
  const lines = section.split('\n').filter((l) => l.startsWith('- **'))
  if (lines.length === 0) fail('STATE.md has no "## Module status" bullet lines')
  const names = lines.map((l) => (l.match(/^- \*\*(.+?)\*\*/) ?? [])[1]).filter(Boolean)
  const dupes = names.filter((n, i) => names.indexOf(n) !== i)
  dupes.length ? fail(`duplicate module entries: ${[...new Set(dupes)].join(', ')}`) : ok(`${names.length} module lines, no duplicates`)
  const shaLike = lines.filter((l) => /\b[0-9a-f]{7,40}\b/.test(l.replace(/`[^`]*`/g, '')))
  shaLike.length ? fail(`commit-SHA-like strings in module lines: ${shaLike.map((l) => l.slice(0, 60)).join(' | ')}`) : ok('no commit SHAs in module lines')
  const sized = lines.filter((l) => /\d+(\.\d+)?\s?(kB|KB|kb)\b/.test(l))
  sized.length ? fail('build sizes in module lines') : ok('no build sizes in module lines')
  const dated = lines.filter((l) => /\b\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/.test(l))
  dated.length ? fail(`dates inside module status lines (history → changelog): ${dated.map((l) => l.slice(0, 50)).join(' | ')}`) : ok('no dates in module lines')
}

// ── 3. Pattern ID uniqueness ─────────────────────────────────────────────────
console.log('\n[3] bug_patterns.md — pattern ID uniqueness')
const bp = read(REF('bug_patterns.md'))
const ids = [...bp.matchAll(/^### (?:Pattern )?([A-Z]{1,3}\d+) /gm)].map((m) => m[1])
const dupIds = ids.filter((x, i) => ids.indexOf(x) !== i)
dupIds.length ? fail(`duplicate pattern IDs: ${[...new Set(dupIds)].join(', ')}`) : ok(`${ids.length} pattern headings, all unique`)

// ── 4. Pattern reference integrity (live files only — history may cite old IDs) ──
console.log('\n[4] Pattern references in live files resolve to real headings')
const LIVE = ['ripple_effects.md', 'architecture.md', 'data_model.md', 'decisions_active.md',
  'design_system.md', 'player_design_system.md', 'session_loop.md', 'deployment.md', 'business_context.md']
const headingSet = new Set(ids)
let refCount = 0, badRefs = []
const scanRefs = (text, label) => {
  for (const m of text.matchAll(/Pattern ([A-Z]{1,3}\d+)\b/g)) {
    refCount++
    if (!headingSet.has(m[1])) badRefs.push(`${label}: Pattern ${m[1]}`)
  }
}
scanRefs(read(join(SKILL_DIR, 'SKILL.md')), 'SKILL.md')
if (existsSync(statePath)) scanRefs(read(statePath), 'STATE.md')
for (const f of LIVE) if (existsSync(REF(f))) scanRefs(read(REF(f)), f)
badRefs.length ? fail(`unknown pattern references: ${[...new Set(badRefs)].join('; ')}`) : ok(`${refCount} pattern references all resolve`)

// ── 5. Migration coverage in STATE.md ────────────────────────────────────────
console.log('\n[5] Every supabase/migrations/*.sql appears in STATE.md ledger')
const migDir = join(ROOT, 'supabase', 'migrations')
if (existsSync(migDir) && existsSync(statePath)) {
  const state = read(statePath)
  const missing = readdirSync(migDir).filter((f) => f.endsWith('.sql'))
    .filter((f) => !state.includes(f.replace('.sql', '')))
  missing.length ? fail(`migrations absent from STATE.md ledger: ${missing.join(', ')}`) : ok('all migration files covered')
} else warn('migrations dir or STATE.md missing — skipped')

// ── 6. Open P0/P1 coverage (CLI only — degrades gracefully offline) ──────────
console.log('\n[6] Every open P0/P1 GitHub issue appears in STATE.md')
try {
  const out = execSync('gh issue list --state open --repo Sugeet21/clubkeeper --json number,labels --limit 200',
    { cwd: ROOT, encoding: 'utf8', timeout: 20000 })
  const issues = JSON.parse(out)
  const p01 = issues.filter((i) => i.labels.some((l) => /^P[01]$/i.test(l.name))).map((i) => i.number)
  const state = read(statePath)
  const missing = p01.filter((n) => !new RegExp(`#${n}\\b`).test(state))
  missing.length ? fail(`open P0/P1 issues missing from STATE.md: ${missing.map((n) => '#' + n).join(', ')}`)
    : ok(`${p01.length} open P0/P1 issues all present in STATE.md`)
} catch { warn('gh unavailable/offline — P0/P1 coverage skipped (re-run when online)') }

// ── 7. Changelog ordering — first dated heading must be the newest ───────────
console.log('\n[7] changelog.md — newest entry at top')
{
  const cl = read(HISTORY_AWARE('changelog.md'))
  const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const dates = [...cl.matchAll(/^## (\d{1,2})(?:[–-]\d{1,2})? (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})/gm)]
    .map((m) => new Date(+m[3], M[m[2]], +m[1]).getTime())
  if (dates.length < 2) warn('fewer than 2 dated headings parsed — ordering not checkable')
  else dates[0] >= Math.max(...dates) ? ok('first dated heading is the newest') : fail('a newer entry exists below the top — new entries must PREPEND')
}

// ── 8. STATE.md freshness stamp ──────────────────────────────────────────────
console.log('\n[8] STATE.md "Last verified" stamp is not older than the latest skill commit')
try {
  const state = read(statePath)
  const m = state.match(/Last verified: (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4})/)
  if (!m) fail('STATE.md missing "Last verified: <d Mon yyyy>" stamp')
  else {
    const M = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    const stamp = new Date(+m[3], M[m[2]], +m[1])
    const last = new Date(git('log -1 --format=%cs -- .claude/skills/clubkeeper').trim())
    stamp >= new Date(last.getFullYear(), last.getMonth(), last.getDate())
      ? ok(`stamp ${m[0].slice(15)} covers latest skill commit`)
      : fail(`stamp (${m[1]} ${m[2]} ${m[3]}) older than latest skill commit (${last.toDateString()}) — update STATE.md`)
  }
} catch (e) { warn(`freshness check errored: ${String(e).slice(0, 80)}`) }

// ── 9. Loading-map link integrity ────────────────────────────────────────────
console.log('\n[9] File paths referenced in SKILL.md / STATE.md exist')
{
  const text = read(join(SKILL_DIR, 'SKILL.md')) + (existsSync(statePath) ? read(statePath) : '')
  const paths = [...new Set([...text.matchAll(/`((?:references\/|STATE\.md)[\w./-]*?\.md)`/g)].map((m) => m[1]))]
  const missing = paths.filter((p) => !existsSync(join(SKILL_DIR, p)) &&
    !existsSync(join(SKILL_DIR, p.replace('references/', 'references/history/'))))
  missing.length ? fail(`referenced files missing: ${missing.join(', ')}`) : ok(`${paths.length} referenced paths all exist`)
}

// ── Verdict ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`)
if (failures.length) {
  console.log(`\x1b[31mCHECK-SKILL: FAIL\x1b[0m — ${failures.length} failure(s), ${warnings.length} warning(s)`)
  process.exit(1)
} else {
  console.log(`\x1b[32mCHECK-SKILL: PASS\x1b[0m — 0 failures, ${warnings.length} warning(s)`)
}
