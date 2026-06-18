/**
 * 桌面与移动端发版产物收集、命名与上传过滤。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

import { allowsDesktopArtifact } from './release-platforms.mjs'

/** @typedef {import('./release-platforms.mjs').PlatformSelection} PlatformSelection */

const DESKTOP_TRIPLE_BUNDLE_DIRS = {
  windows: 'x86_64-pc-windows-msvc/release/bundle',
  macos: ['aarch64-apple-darwin/release/bundle', 'x86_64-apple-darwin/release/bundle'],
  linux: 'x86_64-unknown-linux-gnu/release/bundle',
}

export const DESKTOP_ARTIFACT_PATTERN = /\.(exe|msi|dmg|sig|tar\.gz|AppImage)$/i
export const ARTIFACT_CHECK_PATTERN = /\.(exe|msi|dmg|sig|tar\.gz|AppImage|apk|aab|ipa|json)$/i

const MOBILE_EXTENSIONS = new Set(['.apk', '.aab', '.ipa'])

/**
 * @param {string} fileName
 */
export function isMobileArtifact(fileName) {
  return MOBILE_EXTENSIONS.has(extname(fileName).toLowerCase())
}

/**
 * 上传时是否包含该文件（移动端包名通常不含版本号，始终上传）。
 * @param {string} fileName
 * @param {string} releaseVersion
 */
export function shouldIncludeReleaseAsset(fileName, releaseVersion) {
  if (fileName === 'latest.json') return true
  if (isMobileArtifact(fileName)) return true
  /** macOS updater 包通常不带版本号 */
  if (/\.app\.tar\.gz$/i.test(fileName)) return true
  if (/\.app\.tar\.gz\.sig$/i.test(fileName)) return true
  if (!releaseVersion) return true
  return fileName.includes(releaseVersion)
}

/**
 * @param {string} dir
 * @param {import('./release-platforms.mjs').PlatformSelection | null} [selection]
 * @param {string[]} [acc]
 */
export function collectDesktopBundleFiles(dir, selection = null, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      collectDesktopBundleFiles(fullPath, selection, acc)
      continue
    }
    if (!DESKTOP_ARTIFACT_PATTERN.test(entry)) continue
    if (selection && !allowsDesktopArtifact(entry, selection)) continue
    acc.push(fullPath)
  }
  return acc
}

/**
 * 按平台选择解析桌面 bundle 目录（含交叉编译 target triple）。
 * @param {string} projectRoot
 * @param {PlatformSelection} selection
 * @returns {string[]}
 */
export function resolveDesktopBundleRoots(projectRoot, selection) {
  const targetBase = join(projectRoot, 'src-tauri/target')
  /** @type {string[]} */
  const roots = []
  const seen = new Set()

  const add = (relativePath) => {
    const abs = join(targetBase, relativePath)
    if (seen.has(abs)) return
    seen.add(abs)
    roots.push(abs)
  }

  if (selection.useDefaultDesktopBuild) {
    add('release/bundle')
  }
  if (selection.windows) {
    add(DESKTOP_TRIPLE_BUNDLE_DIRS.windows)
  }
  if (selection.macos) {
    for (const dir of DESKTOP_TRIPLE_BUNDLE_DIRS.macos) add(dir)
  }
  if (selection.linux) {
    add(DESKTOP_TRIPLE_BUNDLE_DIRS.linux)
  }

  return roots
}

/**
 * @param {string[]} bundleRoots
 * @param {PlatformSelection | null} [selection]
 */
export function collectDesktopBundleFilesFromRoots(bundleRoots, selection = null) {
  /** @type {string[]} */
  const files = []
  const seen = new Set()

  for (const root of bundleRoots) {
    for (const file of collectDesktopBundleFiles(root, selection)) {
      if (seen.has(file)) continue
      seen.add(file)
      files.push(file)
    }
  }

  return files
}

/**
 * @param {string} dir
 * @param {string[]} [acc]
 */
function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) walkFiles(fullPath, acc)
    else acc.push(fullPath)
  }
  return acc
}

/**
 * @param {string} filePath
 */
function isReleaseBuildPath(filePath) {
  const lower = filePath.toLowerCase()
  if (lower.includes('debug')) return false
  return lower.includes('release')
}

/**
 * @param {string[]} files
 */
function preferUniversalFiles(files) {
  if (files.length <= 1) return files
  const universal = files.filter((file) => basename(file).toLowerCase().includes('universal'))
  return universal.length > 0 ? universal : files
}

/**
 * @param {string[]} files
 */
function pickBestApks(files) {
  const apks = files.filter((file) => file.toLowerCase().endsWith('.apk') && isReleaseBuildPath(file))
  if (apks.length === 0) return []
  const signed = apks.filter((file) => !basename(file).toLowerCase().includes('unsigned'))
  return preferUniversalFiles(signed.length > 0 ? signed : apks)
}

/**
 * @param {string[]} files
 */
function pickAabs(files) {
  return preferUniversalFiles(
    files.filter((file) => file.toLowerCase().endsWith('.aab') && isReleaseBuildPath(file)),
  )
}

/**
 * Tauri iOS 导出到 gen/apple/build/{arch}/*.ipa，路径不含 release。
 * @param {string[]} files
 */
function pickIpas(files) {
  return files.filter((file) => {
    const lower = file.toLowerCase()
    if (!lower.endsWith('.ipa') || lower.includes('debug')) return false
    if (lower.includes('gen/apple/build')) return true
    return isReleaseBuildPath(file)
  })
}

/**
 * @param {string} projectRoot
 * @param {Record<string, unknown>} [releaseConfigRaw]
 */
export function getMobileSearchRoots(projectRoot, releaseConfigRaw = {}) {
  const tauriRoot = join(projectRoot, 'src-tauri')
  /** @type {string[]} */
  const extraDirs = Array.isArray(releaseConfigRaw.mobile?.artifactDirs)
    ? releaseConfigRaw.mobile.artifactDirs
    : []

  return [
    join(tauriRoot, 'gen/android/app/build/outputs'),
    join(tauriRoot, 'gen/apple/build'),
    ...extraDirs.map((dir) => {
      const value = String(dir)
      if (/^([A-Za-z]:[\\/]|\/)/.test(value)) return value
      return join(projectRoot, value)
    }),
  ]
}

/**
 * @param {string} projectRoot
 * @param {Record<string, unknown>} [releaseConfigRaw]
 * @param {{ android?: boolean, ios?: boolean }} [options]
 */
export function collectMobileArtifacts(projectRoot, releaseConfigRaw = {}, options = {}) {
  const includeAndroid = options.android !== false
  const includeIos = options.ios !== false
  const roots = getMobileSearchRoots(projectRoot, releaseConfigRaw)
  const allFiles = roots.flatMap((root) => walkFiles(root))

  /** @type {string[]} */
  const picked = []
  if (includeAndroid) {
    picked.push(...pickBestApks(allFiles), ...pickAabs(allFiles))
  }
  if (includeIos) {
    picked.push(...pickIpas(allFiles))
  }

  return [...new Set(picked)]
}

/**
 * 复制到 artifacts 时使用带版本号的文件名，便于 Release 页面识别。
 * @param {string} filePath
 * @param {string} appName
 * @param {string} version
 */
export function mobileArtifactDestName(filePath, appName, version) {
  const ext = extname(filePath).toLowerCase()
  const safeApp = appName.replace(/\s+/g, '_')
  if (ext === '.apk') return `${safeApp}_${version}_android-universal${ext}`
  if (ext === '.aab') return `${safeApp}_${version}_android-universal${ext}`
  if (ext === '.ipa') return `${safeApp}_${version}_ios${ext}`
  return basename(filePath)
}

/**
 * @param {string} artifactDir
 */
export function hasReleaseArtifacts(artifactDir) {
  if (!existsSync(artifactDir)) return false
  return readdirSync(artifactDir).some((name) => ARTIFACT_CHECK_PATTERN.test(name))
}
