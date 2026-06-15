import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * @param {string} projectRoot
 */
export async function getTauriReleaseUtils(projectRoot) {
  const base = join(projectRoot, 'node_modules/tauri-release-utils/scripts/lib')
  const bump = await import(pathToFileURL(join(base, 'bump-version.mjs')).href)
  const config = await import(pathToFileURL(join(base, 'release-config.mjs')).href)
  return { bump, config }
}

/**
 * @param {string} projectRoot
 */
export async function getProjectVersion(projectRoot) {
  const { config } = await getTauriReleaseUtils(projectRoot)
  return config.loadReleaseConfig(projectRoot).version
}

/**
 * @param {string} projectRoot
 * @param {string} version
 * @param {{ dryRun?: boolean }} [options]
 */
export async function setProjectVersion(projectRoot, version, options = {}) {
  const dryRun = options.dryRun ?? false
  const { bump, config } = await getTauriReleaseUtils(projectRoot)
  const cfg = config.loadReleaseConfig(projectRoot)
  const from = cfg.version
  const to = String(version).trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+/.test(to)) {
    throw new Error(`[set-version] 无效版本号：${version}`)
  }

  const jsonAbsList = bump.collectJsonPathsToBump(cfg)
  const cargoAbs = resolve(cfg.projectRoot, cfg.cargoTomlPath)

  if (dryRun) {
    return { from, to, files: [...jsonAbsList, cargoAbs] }
  }

  const files = []
  for (const abs of jsonAbsList) {
    writeJsonVersionField(abs, to)
    files.push(abs)
  }

  if (!existsSync(cargoAbs)) {
    throw new Error(`[set-version] 未找到 Cargo.toml：${cargoAbs}`)
  }
  const cargoRaw = readFileSync(cargoAbs, 'utf-8')
  writeFileSync(cargoAbs, bump.replaceCargoPackageVersion(cargoRaw, to), 'utf-8')
  files.push(cargoAbs)

  return { from, to, files }
}

/**
 * @param {string} jsonPath
 * @param {string} newVersion
 */
function writeJsonVersionField(jsonPath, newVersion) {
  const abs = resolve(jsonPath)
  const raw = readFileSync(abs, 'utf-8')
  const data = JSON.parse(raw)
  if (typeof data !== 'object' || data === null || typeof data.version !== 'string') {
    throw new Error(`[set-version] ${abs} 缺少顶层 string version 字段`)
  }
  data.version = newVersion
  writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}
