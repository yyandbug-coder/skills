#!/usr/bin/env node
/**
 * 薄封装：将发版命令转发到 tauri-app-updater Skill。
 * 兼容 npx skills 安装路径（~/.agents/skills）与项目内路径。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const skillScript = process.argv[2]
if (!skillScript) {
  console.error('[updater-skill] 缺少 skill 脚本名')
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
  console.error('[updater-skill] 未找到 tauri-app-updater skill\n')
  console.error('  安装（每台电脑一次）：')
  console.error('    npx skills add yyandbug-coder/kitty-tools --skill tauri-app-updater -g -y')
  console.error('\n  接入项目（每个项目一次）：')
  console.error('    node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs')
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
