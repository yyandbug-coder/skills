#!/usr/bin/env node
/**
 * Thin wrapper: forwards release commands to tauri-app-updater Skill.
 * Resolves skill from project paths first, then global install paths.
 * (ASCII-only source: avoids Windows encoding parse errors in .mjs files.)
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const skillScript = process.argv[2]
if (!skillScript) {
  console.error('[updater-skill] missing skill script name (e.g. release-interactive.mjs)')
  process.exit(1)
}

function findSkillRoot() {
  const home = homedir()
  const cwd = process.cwd()
  const candidates = [
    join(cwd, 'skills/tauri-app-updater'),
    join(cwd, '.agents/skills/tauri-app-updater'),
    join(cwd, '.cursor/skills/tauri-app-updater'),
    join(home, '.agents/skills/tauri-app-updater'),
    join(home, '.cursor/skills/tauri-app-updater'),
  ]
  for (const root of candidates) {
    if (existsSync(join(root, 'scripts', skillScript))) return root
  }
  return ''
}

const skillRoot = findSkillRoot()
if (!skillRoot) {
  console.error('[updater-skill] tauri-app-updater skill not found\n')
  console.error('  Install once per machine:')
  console.error('    npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y')
  console.error('\n  Wire project once:')
  console.error('    node skills/tauri-app-updater/scripts/init-project.mjs')
  console.error('    (or: node %USERPROFILE%\\.agents\\skills\\tauri-app-updater\\scripts\\init-project.mjs)')
  process.exit(1)
}

const scriptPath = join(skillRoot, 'scripts', skillScript)
const result = spawnSync('node', [scriptPath, ...process.argv.slice(3)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
  shell: false,
})
process.exit(result.status ?? 1)
