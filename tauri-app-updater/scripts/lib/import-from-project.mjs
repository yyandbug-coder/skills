import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 从项目 node_modules 加载依赖（Skill 脚本不在项目目录内，不能直接用裸 import）。
 * @param {string} projectRoot
 * @param {string} packageName
 */
export async function importFromProject(projectRoot, packageName) {
  const entry = resolvePackageEntry(projectRoot, packageName)
  if (!entry) {
    throw new Error(
      `[tauri-app-updater] 缺少依赖 ${packageName}，请在项目根目录执行：pnpm install`,
    )
  }
  return import(pathToFileURL(entry).href)
}

/**
 * @param {string} projectRoot
 * @param {string} packageName
 */
function resolvePackageEntry(projectRoot, packageName) {
  const pkgDir = join(projectRoot, 'node_modules', ...packageName.split('/'))
  if (!existsSync(pkgDir)) return ''

  const pkgJsonPath = join(pkgDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
    const candidates = [
      pkg.exports?.['.']?.import,
      pkg.exports?.['.']?.default,
      pkg.module,
      pkg.main,
    ].filter((value) => typeof value === 'string')

    for (const candidate of candidates) {
      const resolved = join(pkgDir, candidate.replace(/^\.\//, ''))
      if (existsSync(resolved)) return resolved
    }
  }

  const fallbacks = [
    join(pkgDir, 'dist/index.mjs'),
    join(pkgDir, 'index.mjs'),
    join(pkgDir, 'index.js'),
  ]
  for (const file of fallbacks) {
    if (existsSync(file)) return file
  }

  return ''
}
