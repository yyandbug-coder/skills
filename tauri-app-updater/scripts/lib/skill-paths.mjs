import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const skillRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))

export function getSkillRoot() {
  return skillRoot
}

/**
 * @param {string} [startDir]
 */
export function resolveProjectRoot(startDir = process.cwd()) {
  let current = resolve(startDir)

  while (true) {
    const hasPackage = existsSync(join(current, 'package.json'))
    const hasTauri = existsSync(join(current, 'src-tauri'))
    const hasReleaseConfig = existsSync(join(current, 'release.config.json'))
    if (hasPackage && (hasTauri || hasReleaseConfig)) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new Error(
    '[tauri-app-updater] 未找到项目根目录。请在 Tauri 项目根执行，或设置 TAURI_UPDATER_PROJECT_ROOT。',
  )
}

export function getProjectRoot() {
  if (process.env.TAURI_UPDATER_PROJECT_ROOT) {
    return resolve(process.env.TAURI_UPDATER_PROJECT_ROOT)
  }
  return resolveProjectRoot()
}
