/**
 * 项目定位、release.config.json 读取、版本号读写。
 *
 * 版本号递增以前是深引 `node_modules/tauri-release-utils/scripts/lib/bump-version.mjs`
 * 的私有内部路径——为了三十行逻辑背一个包，且包一改内部布局就崩。这里自己实现：
 * package.json / tauri.conf.json 用 JSON 改写，Cargo.toml 只替换 `[package]` 段里的
 * version（正则限定在第一个 section 内，避免误伤依赖项的 version）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'
import { homedir } from 'node:os'

import { ReleaseError } from './log.mjs'
import { detectPackageManager } from './package-manager.mjs'

const CONFIG_NAME = 'release.config.json'

/**
 * 旧版配置里已经废弃的字段 → 现在的替代品。
 *
 * 多个项目分别在不同时期接入时，旧格式会**静默失效**：新代码读不到 `tauriBuildCommand`，
 * 于是悄悄退回默认命令，构建的还是别的东西。宁可直接报错也不能不吭声。
 */
const LEGACY_KEYS = {
  tauriBuildCommand: 'build.default',
  desktop: 'build.<平台id>（见 reference.md 平台矩阵）',
  mobile: '已移除——本 Skill 只做桌面端',
  versionBump: '已移除——用 --part / --set-version',
  releaseArtifactLayout: '已移除——产物固定在 releases/v{version}/',
}

/**
 * @param {Record<string, unknown>} raw
 * @param {string} configPath
 */
function assertNotLegacyConfig(raw, configPath) {
  const found = Object.keys(LEGACY_KEYS).filter((key) => raw[key] !== undefined)
  if (found.length === 0) return

  throw new ReleaseError(`${CONFIG_NAME} 还是旧版格式`, {
    hints: [
      `文件：${configPath}`,
      ...found.map((key) => `  ${key} → ${LEGACY_KEYS[key]}`),
      '模板见 <skill>/templates/release.config.json，或删掉旧文件重跑 cli.mjs init',
    ],
  })
}

/** 语义化版本（允许 -beta.1 之类后缀）。 */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * 向上找同时具备 package.json 与 src-tauri/ 的目录。
 * @param {string} [startDir]
 */
export function resolveProjectRoot(startDir = process.cwd()) {
  if (process.env.TAURI_UPDATER_PROJECT_ROOT) {
    return resolve(process.env.TAURI_UPDATER_PROJECT_ROOT)
  }

  let current = resolve(startDir)
  for (;;) {
    const hasPackage = existsSync(join(current, 'package.json'))
    const hasTauri = existsSync(join(current, 'src-tauri'))
    if (hasPackage && (hasTauri || existsSync(join(current, CONFIG_NAME)))) return current

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new ReleaseError('未找到 Tauri 项目根目录', {
    hints: [
      '请在项目根目录（含 package.json 与 src-tauri/）执行',
      '或设置环境变量 TAURI_UPDATER_PROJECT_ROOT',
    ],
  })
}

/** @param {string} path */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ReleaseError(`无法解析 JSON：${path}`, {
      hints: [error instanceof Error ? error.message : String(error)],
    })
  }
}

/** @param {string} path @param {unknown} data */
function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

/**
 * 展开 `~`、把相对路径挂到项目根下；已是绝对路径则原样返回。
 * @param {string} projectRoot
 * @param {string} value
 */
export function resolveProjectPath(projectRoot, value) {
  const trimmed = String(value).trim()
  if (!trimmed) return ''
  if (trimmed === '~') return homedir()
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2))
  }
  if (isAbsolute(trimmed) || win32.isAbsolute(trimmed)) return trimmed
  return join(projectRoot, trimmed)
}

/**
 * 读取 release.config.json 并补齐默认值。
 * @param {string} projectRoot
 */
export function loadReleaseConfig(projectRoot) {
  const configPath = join(projectRoot, CONFIG_NAME)
  if (!existsSync(configPath)) {
    throw new ReleaseError(`缺少 ${CONFIG_NAME}`, {
      hints: ['在项目根目录执行：node <skill>/scripts/cli.mjs init'],
    })
  }

  const raw = readJson(configPath)
  assertNotLegacyConfig(raw, configPath)
  const tauriConfigPath = join(projectRoot, raw.tauriConfigPath || 'src-tauri/tauri.conf.json')
  const cargoTomlPath = join(projectRoot, raw.cargoTomlPath || 'src-tauri/Cargo.toml')

  return {
    raw,
    configPath,
    projectRoot,
    packageManager: detectPackageManager(projectRoot),
    appName: resolveAppName(projectRoot, raw, tauriConfigPath),
    tauriConfigPath,
    cargoTomlPath,
    releaseDir: raw.releaseDir || 'releases',
    buildCommands: raw.build ?? {},
    signing: raw.signing ?? {},
    github: raw.github ?? null,
    gitcode: raw.gitcode ?? null,
    /** 自建更新服务器：baseUrl + uploadCommand，见 reference.md */
    custom: raw.custom ?? null,
    /** 提交进仓库的 releases/latest.json 用哪个目标的 URL 规则；留空则取第一个已配置的。 */
    primaryTarget: raw.primaryTarget || '',
    /** 发版前跑的项目自定义校验命令（如 changelog 检查），`{version}` 会被替换。 */
    notesCommand: raw.notesCommand || '',
    checkCommands: Array.isArray(raw.checkCommands) ? raw.checkCommands : [],
  }
}

/**
 * @param {string} projectRoot
 * @param {Record<string, unknown>} raw
 * @param {string} tauriConfigPath
 */
function resolveAppName(projectRoot, raw, tauriConfigPath) {
  if (typeof raw.appName === 'string' && raw.appName.trim()) return raw.appName.trim()
  if (existsSync(tauriConfigPath)) {
    const productName = readJson(tauriConfigPath).productName
    if (typeof productName === 'string' && productName.trim()) return productName.trim()
  }
  const packagePath = join(projectRoot, 'package.json')
  if (existsSync(packagePath)) {
    const pkg = readJson(packagePath)
    return pkg.productName || pkg.name || 'App'
  }
  return 'App'
}

/**
 * 需要同步版本号的三个文件。缺失的直接跳过（有些项目没有 Cargo workspace 成员）。
 * @param {ReturnType<typeof loadReleaseConfig>} config
 */
export function collectVersionFiles(config) {
  /** @type {Array<{ path: string, kind: 'json' | 'cargo' }>} */
  const files = []
  const packagePath = join(config.projectRoot, 'package.json')
  if (existsSync(packagePath)) files.push({ path: packagePath, kind: 'json' })
  if (existsSync(config.tauriConfigPath)) files.push({ path: config.tauriConfigPath, kind: 'json' })
  if (existsSync(config.cargoTomlPath)) files.push({ path: config.cargoTomlPath, kind: 'cargo' })
  return files
}

/**
 * 当前版本号，以 tauri.conf.json 为准（updater 比对的就是包版本）。
 * @param {ReturnType<typeof loadReleaseConfig>} config
 */
export function readProjectVersion(config) {
  if (existsSync(config.tauriConfigPath)) {
    const version = readJson(config.tauriConfigPath).version
    if (typeof version === 'string' && version.trim()) return version.trim()
  }
  const packagePath = join(config.projectRoot, 'package.json')
  if (existsSync(packagePath)) {
    const version = readJson(packagePath).version
    if (typeof version === 'string' && version.trim()) return version.trim()
  }
  throw new ReleaseError('无法读取当前版本号（tauri.conf.json / package.json 均无 version）')
}

/**
 * Cargo.toml 只改 `[package]` 段内的 version：依赖项也叫 version，全局替换会写坏文件。
 * @param {string} raw
 * @param {string} version
 */
export function replaceCargoPackageVersion(raw, version) {
  const packageSection = /(^|\n)\[package\]\r?\n([\s\S]*?)(?=\n\[|$)/
  const match = packageSection.exec(raw)
  if (!match) {
    throw new ReleaseError('Cargo.toml 未找到 [package] 段')
  }

  const body = match[2]
  const replaced = body.replace(/^(\s*version\s*=\s*")[^"]*(")/m, `$1${version}$2`)
  if (replaced === body) {
    throw new ReleaseError('Cargo.toml 的 [package] 段没有 version 字段')
  }
  return raw.slice(0, match.index) + match[1] + '[package]\n' + replaced + raw.slice(match.index + match[0].length)
}

/**
 * @param {string} version
 * @param {'patch' | 'minor' | 'major'} part
 */
export function bumpVersion(version, part) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
  if (!match) throw new ReleaseError(`无法递增的版本号：${version}`)

  let [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (part === 'major') {
    major += 1
    minor = 0
    patch = 0
  } else if (part === 'minor') {
    minor += 1
    patch = 0
  } else {
    patch += 1
  }
  return `${major}.${minor}.${patch}`
}

/**
 * 把版本号写进 package.json / tauri.conf.json / Cargo.toml。
 * @param {ReturnType<typeof loadReleaseConfig>} config
 * @param {string} version
 * @param {{ dryRun?: boolean }} [options]
 */
export function writeProjectVersion(config, version, options = {}) {
  const to = String(version).trim().replace(/^v/, '')
  if (!SEMVER_PATTERN.test(to)) {
    throw new ReleaseError(`无效版本号：${version}`, { hints: ['格式形如 0.1.13 或 0.2.0-beta.1'] })
  }

  const from = readProjectVersion(config)
  const files = collectVersionFiles(config)
  if (options.dryRun) return { from, to, files: files.map((file) => file.path) }

  for (const file of files) {
    if (file.kind === 'json') {
      const data = readJson(file.path)
      if (typeof data.version !== 'string') {
        throw new ReleaseError(`${relative(config.projectRoot, file.path)} 缺少顶层 version 字段`)
      }
      data.version = to
      writeJson(file.path, data)
    } else {
      writeFileSync(file.path, replaceCargoPackageVersion(readFileSync(file.path, 'utf8'), to), 'utf8')
    }
  }

  return { from, to, files: files.map((file) => file.path) }
}

/**
 * 本版本产物目录：releases/v{version}/
 * @param {ReturnType<typeof loadReleaseConfig>} config
 * @param {string} version
 */
export function resolveArtifactDir(config, version) {
  return join(config.projectRoot, config.releaseDir, `v${String(version).replace(/^v/, '')}`)
}

/**
 * @param {string} projectRoot
 * @param {string} absPath
 */
export function toRelative(projectRoot, absPath) {
  const rel = relative(projectRoot, absPath)
  return rel && !rel.startsWith('..') ? rel.replace(/\\/g, '/') : absPath.replace(/\\/g, '/')
}

export { readJson, writeJson }
