/**
 * 包管理器探测。
 *
 * 老实现把 `pnpm` 硬编码进默认构建命令和所有提示里——只服务一个项目时看不出问题，
 * 但换成 npm / yarn / bun 的 Tauri 项目，生成的 `release.config.json` 一上来就是坏的。
 *
 * 各家调用 tauri CLI 的写法并不统一，尤其 npm 需要 `run` + `--` 才能把参数透传给
 * 子命令，所以这里不做字符串拼接，由 [`tauriCommand`] 统一产出。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** @typedef {'pnpm' | 'npm' | 'yarn' | 'bun'} PackageManager */

const LOCKFILES = /** @type {const} */ ([
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
])

/**
 * 优先信 package.json 的 `packageManager`（corepack 的权威声明），其次看 lockfile。
 *
 * @param {string} projectRoot
 * @returns {PackageManager}
 */
export function detectPackageManager(projectRoot) {
  const packagePath = join(projectRoot, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const declared = JSON.parse(readFileSync(packagePath, 'utf8')).packageManager
      const name = typeof declared === 'string' ? declared.split('@')[0].trim() : ''
      if (name === 'pnpm' || name === 'npm' || name === 'yarn' || name === 'bun') return name
    } catch {
      // package.json 坏了不该在这里报错，交给后面真正读它的地方。
    }
  }

  for (const [lockfile, manager] of LOCKFILES) {
    if (existsSync(join(projectRoot, lockfile))) return /** @type {PackageManager} */ (manager)
  }
  return 'pnpm'
}

/**
 * 拼一条调用 tauri CLI 的命令。
 *
 * npm 的参数透传规则和别人不一样：`npm run tauri build --target X` 里的 `--target`
 * 会被 **npm 自己**当成选项吃掉，而不是转给 tauri。必须把所有参数放在 `--` 之后。
 * 这里统一走 `npm run tauri -- <全部参数>`，对单参数和多参数都成立。
 *
 * @param {PackageManager} manager
 * @param {string[]} args 例如 `['build', '--target', 'universal-apple-darwin']`
 */
export function tauriCommand(manager, args) {
  if (manager === 'npm') return `npm run tauri -- ${args.join(' ')}`
  return `${manager} tauri ${args.join(' ')}`
}

/**
 * 装依赖的命令（仅用于提示文案）。
 * @param {PackageManager} manager
 */
export function installCommand(manager) {
  return manager === 'npm' ? 'npm install' : `${manager} install`
}

/**
 * 跑 package.json script 的命令（仅用于提示文案）。
 *
 * 同样注意 npm：`npm run release:doctor --fix` 的 `--fix` 是给 npm 的，脚本收不到。
 * yarn 1.x 也需要 `--`，pnpm / bun 直接透传。
 *
 * @param {PackageManager} manager
 * @param {string} script
 * @param {string[]} [scriptArgs]
 */
export function runScriptCommand(manager, script, scriptArgs = []) {
  const base = manager === 'npm' ? `npm run ${script}` : `${manager} ${script}`
  if (scriptArgs.length === 0) return base
  const separator = manager === 'npm' || manager === 'yarn' ? ' -- ' : ' '
  return `${base}${separator}${scriptArgs.join(' ')}`
}
