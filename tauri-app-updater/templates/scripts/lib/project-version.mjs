/**
 * 将 Tauri 项目版本号同步写入 tauri.conf.json、Cargo.toml、package.json 等。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  collectJsonPathsToBump,
  replaceCargoPackageVersion,
} from '../../node_modules/tauri-release-utils/scripts/lib/bump-version.mjs'
import { loadReleaseConfig } from '../../node_modules/tauri-release-utils/scripts/lib/release-config.mjs'

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

/**
 * @param {string} projectRoot
 * @returns {string}
 */
export function getProjectVersion(projectRoot) {
  return loadReleaseConfig(projectRoot).version
}

/**
 * @param {string} projectRoot
 * @param {string} version
 * @param {{ dryRun?: boolean }} [options]
 * @returns {{ from: string, to: string, files: string[] }}
 */
export function setProjectVersion(projectRoot, version, options = {}) {
  const dryRun = options.dryRun ?? false
  const cfg = loadReleaseConfig(projectRoot)
  const from = cfg.version
  const to = String(version).trim().replace(/^v/, '')
  if (!/^\d+\.\d+\.\d+/.test(to)) {
    throw new Error(`[set-version] 无效版本号：${version}`)
  }

  const jsonAbsList = collectJsonPathsToBump(cfg)
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
  writeFileSync(cargoAbs, replaceCargoPackageVersion(cargoRaw, to), 'utf-8')
  files.push(cargoAbs)

  return { from, to, files }
}
