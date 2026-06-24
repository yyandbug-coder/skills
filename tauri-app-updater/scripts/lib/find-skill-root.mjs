#!/usr/bin/env node
/**
 * Resolve tauri-app-updater Skill root directory.
 * Checks project-local paths first, then global npx skills install paths.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SKILL_NAME = 'tauri-app-updater'

/**
 * @param {string} [skillScript] verify scripts/<name> exists under skill root
 */
export function findSkillRoot(skillScript = 'release.mjs') {
  const home = homedir()
  const cwd = process.cwd()

  const candidates = [
    join(cwd, 'skills', SKILL_NAME),
    join(cwd, '.agents/skills', SKILL_NAME),
    join(cwd, '.cursor/skills', SKILL_NAME),
    join(home, '.agents/skills', SKILL_NAME),
    join(home, '.cursor/skills', SKILL_NAME),
  ]

  for (const root of candidates) {
    if (existsSync(join(root, 'scripts', skillScript))) return root
  }
  return ''
}

export function printSkillInstallHint() {
  console.error('[updater-skill] tauri-app-updater skill not found')
  console.error('')
  console.error('  Install once per machine:')
  console.error('    npx skills add yyandbug-coder/skills --skill tauri-app-updater -g -y')
  console.error('')
  console.error('  Wire project once:')
  console.error('    node skills/tauri-app-updater/scripts/init-project.mjs')
  console.error('    (or: node %USERPROFILE%\\.agents\\skills\\tauri-app-updater\\scripts\\init-project.mjs)')
}
