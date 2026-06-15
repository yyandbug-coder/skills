#!/usr/bin/env node
/**
 * 解析 tauri-app-updater Skill 根目录。
 * 兼容 npx skills 安装路径（.agents/skills）与项目内路径。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SKILL_NAME = 'tauri-app-updater'

/**
 * @param {string} [skillScript] 用于校验 scripts/ 下是否存在该文件
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
  console.error('[updater-skill] 未找到 tauri-app-updater skill')
  console.error('')
  console.error('  安装 Skill（每台电脑一次）：')
  console.error('    npx skills add yyandbug-coder/kitty-tools --skill tauri-app-updater -g -y')
  console.error('')
  console.error('  接入当前项目（每个项目一次）：')
  console.error('    node ~/.agents/skills/tauri-app-updater/scripts/init-project.mjs')
}
