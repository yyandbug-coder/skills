#!/usr/bin/env node
/**
 * Thin wrapper: forwards release commands to the tauri-app-updater skill.
 *
 * Resolution order is GLOBAL FIRST on purpose. The previous wrapper preferred a
 * project-local copy, so a stale vendored copy silently shadowed the updated
 * skill and produced confusing "function is not defined" style failures.
 * Set TAURI_UPDATER_SKILL_ROOT to pin an explicit location.
 *
 * ASCII-only source: .mjs files re-encoded to GBK/UTF-16 on Windows fail to parse.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SKILL = 'tauri-app-updater'
const ENTRY = join('scripts', 'cli.mjs')

function candidates() {
  const home = homedir()
  const cwd = process.cwd()
  const list = []
  if (process.env.TAURI_UPDATER_SKILL_ROOT) list.push(process.env.TAURI_UPDATER_SKILL_ROOT)
  list.push(
    join(home, '.agents', 'skills', SKILL),
    join(home, '.claude', 'skills', SKILL),
    join(home, '.cursor', 'skills', SKILL),
    join(cwd, '.claude', 'skills', SKILL),
    join(cwd, '.cursor', 'skills', SKILL),
    join(cwd, 'skills', SKILL),
  )
  return list
}

const root = candidates().find((dir) => existsSync(join(dir, ENTRY)))

if (!root) {
  console.error(`[updater-skill] ${SKILL} not found in any of:`)
  for (const dir of candidates()) console.error(`  ${dir}`)
  console.error('')
  console.error('  Install once per machine:')
  console.error(`    npx skills add yyandbug-coder/skills --skill ${SKILL} -g -y`)
  console.error('  Or point at a local checkout:')
  console.error(`    TAURI_UPDATER_SKILL_ROOT=/path/to/${SKILL} pnpm release`)
  process.exit(1)
}

if (process.env.TAURI_UPDATER_SKILL_DEBUG) {
  console.error(`[updater-skill] using ${root}`)
}

const result = spawnSync(process.execPath, [join(root, ENTRY), ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  shell: false,
})
process.exit(result.status ?? 1)
