/**
 * 生成 latest.json —— **每个发版目标一份**，URL 指向该目标自己的附件。
 *
 * 文件名约定：`latest.json` 是主目标的（也是提交进仓库、给人看的那份），
 * 其余目标各自生成 `latest.{target}.json`，上传时统一改名成 `latest.json`。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'

import { ReleaseError } from './log.mjs'
import { pickUpdaterBundle } from './platforms.mjs'
import { assetUrl } from './targets.mjs'

/**
 * @typedef {object} UpdaterEntry
 * @property {string} platformId   来自哪个构建平台
 * @property {string[]} keys       写进 platforms 的 key（universal 是两个）
 * @property {string} fileName     安装包文件名
 * @property {string} signature    .sig 正文
 */

/**
 * 从各平台产物里提取 updater 条目。没有配套 .sig 的平台会被跳过并记进 skipped。
 *
 * @param {Array<{ platform: import('./platforms.mjs').PlatformDescriptor, files: string[] }>} builds
 * @returns {{ entries: UpdaterEntry[], skipped: string[] }}
 */
export function collectUpdaterEntries(builds) {
  /** @type {UpdaterEntry[]} */
  const entries = []
  /** @type {string[]} */
  const skipped = []

  for (const build of builds) {
    const picked = pickUpdaterBundle(build.files, build.platform)
    if (!picked) {
      skipped.push(build.platform.id)
      continue
    }

    // 主机默认构建没有预设 key，按本机 os-arch 推断。
    const keys = build.platform.updaterKeys.length > 0
      ? build.platform.updaterKeys
      : inferKeysFromHost(build.platform)

    entries.push({
      platformId: build.platform.id,
      keys,
      fileName: basename(picked.bundle),
      signature: readFileSync(picked.sig, 'utf8').trim(),
    })
  }

  return { entries, skipped }
}

/**
 * @param {import('./platforms.mjs').PlatformDescriptor} platform
 */
function inferKeysFromHost(platform) {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return [`${platform.os}-${arch}`]
}

/**
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.notes
 * @param {UpdaterEntry[]} options.entries
 * @param {NonNullable<ReturnType<import('./targets.mjs').getTarget>>} options.target
 * @param {string} [options.pubDate]
 */
export function buildManifest({ version, notes, entries, target, pubDate }) {
  if (entries.length === 0) {
    throw new ReleaseError('没有可写入 latest.json 的 updater 产物', {
      hints: [
        '确认 tauri.conf.json 的 bundle.createUpdaterArtifacts 为 true',
        '确认构建时注入了签名私钥（产物旁应有同名 .sig）',
      ],
    })
  }

  /** @type {Record<string, { url: string, signature: string }>} */
  const platforms = {}
  for (const entry of entries) {
    const value = { url: assetUrl(target, version, entry.fileName), signature: entry.signature }
    for (const key of entry.keys) platforms[key] = value
  }

  return {
    version: String(version).replace(/^v/, ''),
    notes,
    pub_date: pubDate ?? new Date().toISOString(),
    platforms,
  }
}

/**
 * @param {string} path
 * @param {ReturnType<typeof buildManifest>} manifest
 */
export function writeManifest(path, manifest) {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

/**
 * macOS 只发了单架构包时提醒：Intel 用户拿到的不是「已是最新」，而是一个红色报错。
 * @param {ReturnType<typeof buildManifest>} manifest
 */
export function auditManifest(manifest) {
  const keys = Object.keys(manifest.platforms)
  /** @type {string[]} */
  const warnings = []

  const hasDarwin = keys.some((key) => key.startsWith('darwin-'))
  if (hasDarwin && !keys.includes('darwin-x86_64')) {
    warnings.push('macOS 只有 Apple Silicon 包：Intel Mac 检查更新会报 TargetNotFound（不是「已是最新」）')
  }
  if (hasDarwin && !keys.includes('darwin-aarch64')) {
    warnings.push('macOS 只有 Intel 包：Apple Silicon 机器检查更新会报 TargetNotFound')
  }

  return warnings
}
