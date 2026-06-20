#!/usr/bin/env node
// Lint guard for Pattern R4 (#97) — fails the build if any src/ file reads
// a ClubSettings field via local useState instead of useDexieSetting.
//
// Anti-patterns flagged:
//   useState(... settings?.field ...)
//   useState(... settings.field ...)
//
// Escape hatch: append `// allow-settings-useState: <reason>` on the same
// line. Use ONLY for atomic multi-field saves (coins) — new uses need a
// comment a human can review in PR.
//
// Runs in `prebuild`, so `npm run build` fails fast on regressions.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

// Skip the hook itself — it's the legitimate consumer of the ClubSettings type.
const SKIP_FILES = new Set([
  join('src', 'hooks', 'useDexieSetting.ts').replaceAll('\\', '/'),
])

const ANTI_PATTERNS = [
  /useState\([^)]*settings\?\.[a-zA-Z_]/,
  /useState\([^)]*\bsettings\.[a-zA-Z_]/,
]

const ALLOW_COMMENT = '// allow-settings-useState:'

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(p)
  }
  return out
}

const hits = []
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).replaceAll('\\', '/')
  if (SKIP_FILES.has(rel)) continue
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.includes(ALLOW_COMMENT)) continue
    for (const re of ANTI_PATTERNS) {
      if (re.test(line)) {
        hits.push({ file: rel, line: i + 1, snippet: line.trim() })
        break
      }
    }
  }
}

if (hits.length === 0) {
  console.log('check-settings-pattern: OK (0 anti-pattern hits).')
  process.exit(0)
}

console.error('check-settings-pattern: FAIL — Pattern R4 violations found.\n')
console.error('Settings fields must be read via useDexieSetting, not local useState.')
console.error('See .claude/skills/clubkeeper/references/bug_patterns.md Pattern R4.')
console.error('If this is an atomic multi-field save (coins-style), append')
console.error('  // allow-settings-useState: <reason>')
console.error('on the same line.\n')
for (const h of hits) {
  console.error(`  ${h.file}:${h.line}`)
  console.error(`    ${h.snippet}`)
}
console.error(`\n${hits.length} violation(s).`)
process.exit(1)
