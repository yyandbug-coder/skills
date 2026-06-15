/**
 * 发版平台解析：支持多选、逗号分隔与简写（desktop / mobile / all）。
 */

/** @typedef {'windows' | 'macos' | 'linux' | 'android' | 'ios'} AtomicPlatform */

/**
 * @typedef {object} PlatformSelection
 * @property {boolean} useDefaultDesktopBuild
 * @property {boolean} windows
 * @property {boolean} macos
 * @property {boolean} linux
 * @property {boolean} android
 * @property {boolean} ios
 */

const ATOMIC = new Set(['windows', 'macos', 'linux', 'android', 'ios'])
const SHORTHAND = new Set(['desktop', 'mobile', 'all'])

/**
 * @param {string[]} argv
 */
export function readPlatformArgs(argv) {
  /** @type {string[]} */
  const tokens = []

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '--platform') continue
    const value = argv[index + 1]
    if (!value) continue
    for (const part of value.split(',')) {
      const token = part.trim().toLowerCase()
      if (token) tokens.push(token)
    }
    index += 1
  }

  if (tokens.length === 0) tokens.push('desktop')
  return normalizePlatformSelection(tokens)
}

/**
 * @param {string[]} tokens
 * @returns {PlatformSelection}
 */
export function normalizePlatformSelection(tokens) {
  const input = new Set(tokens.map((token) => token.trim().toLowerCase()).filter(Boolean))

  if (input.has('all')) {
    input.delete('all')
    input.add('desktop')
    input.add('android')
    input.add('ios')
  }

  if (input.has('mobile')) {
    input.delete('mobile')
    input.add('android')
    input.add('ios')
  }

  for (const token of input) {
    if (!ATOMIC.has(token) && !SHORTHAND.has(token)) {
      throw new Error(
        `[release-platforms] 未知平台 "${token}"，可选：desktop、windows、macos、linux、android、ios、mobile、all`,
      )
    }
  }

  /** @type {PlatformSelection} */
  const selection = {
    useDefaultDesktopBuild: input.has('desktop'),
    windows: input.has('windows'),
    macos: input.has('macos'),
    linux: input.has('linux'),
    android: input.has('android'),
    ios: input.has('ios'),
  }

  input.delete('desktop')

  for (const token of input) {
    if (ATOMIC.has(token)) {
      selection[token] = true
    }
  }

  if (!hasAnyPlatform(selection)) {
    throw new Error('[release-platforms] 至少选择一个发版平台')
  }

  return selection
}

/**
 * @param {PlatformSelection} selection
 */
export function hasAnyPlatform(selection) {
  return (
    selection.useDefaultDesktopBuild ||
    selection.windows ||
    selection.macos ||
    selection.linux ||
    selection.android ||
    selection.ios
  )
}

/**
 * @param {PlatformSelection} selection
 */
export function hasDesktopBuild(selection) {
  return (
    selection.useDefaultDesktopBuild || selection.windows || selection.macos || selection.linux
  )
}

/**
 * @param {PlatformSelection} selection
 */
export function hasMobileBuild(selection) {
  return selection.android || selection.ios
}

/**
 * @param {PlatformSelection} selection
 * @returns {Set<'windows' | 'macos' | 'linux'>}
 */
export function getAllowedDesktopKinds(selection) {
  /** @type {Set<'windows' | 'macos' | 'linux'>} */
  const kinds = new Set()
  const hasSpecific = selection.windows || selection.macos || selection.linux

  if (selection.useDefaultDesktopBuild && !hasSpecific) {
    kinds.add('windows')
    kinds.add('macos')
    kinds.add('linux')
    return kinds
  }

  if (selection.useDefaultDesktopBuild) {
    kinds.add('windows')
    kinds.add('macos')
    kinds.add('linux')
  }
  if (selection.windows) kinds.add('windows')
  if (selection.macos) kinds.add('macos')
  if (selection.linux) kinds.add('linux')

  return kinds
}

/**
 * @param {string} fileName
 * @param {PlatformSelection} selection
 */
export function allowsDesktopArtifact(fileName, selection) {
  const lower = fileName.toLowerCase()
  const kinds = getAllowedDesktopKinds(selection)

  if ((lower.endsWith('.exe') || lower.endsWith('.msi')) && kinds.has('windows')) return true
  if (lower.endsWith('.app.tar.gz') && kinds.has('macos')) return true
  if (lower.endsWith('.appimage') && kinds.has('linux')) return true

  if (lower.endsWith('.sig')) {
    const bundleName = fileName.slice(0, -4)
    return allowsDesktopArtifact(bundleName, selection)
  }

  return false
}

/**
 * @param {PlatformSelection} selection
 * @param {Record<string, unknown>} releaseCfg
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveBuildCommands(selection, releaseCfg, releaseConfigRaw) {
  const desktopCfg = releaseConfigRaw.desktop ?? {}
  const mobileCfg = releaseConfigRaw.mobile ?? {}
  /** @type {string[]} */
  const commands = []

  if (selection.useDefaultDesktopBuild) {
    commands.push(String(releaseCfg.tauriBuildCommand || 'pnpm tauri build'))
  }
  if (selection.windows) {
    commands.push(
      desktopCfg.windowsBuildCommand || 'pnpm tauri build -- --target x86_64-pc-windows-msvc',
    )
  }
  if (selection.macos) {
    commands.push(
      desktopCfg.macosBuildCommand || 'pnpm tauri build -- --target aarch64-apple-darwin',
    )
  }
  if (selection.linux) {
    commands.push(
      desktopCfg.linuxBuildCommand || 'pnpm tauri build -- --target x86_64-unknown-linux-gnu',
    )
  }
  if (selection.android) {
    commands.push(mobileCfg.androidBuildCommand || 'pnpm tauri android build -- --apk --aab')
  }
  if (selection.ios) {
    commands.push(mobileCfg.iosBuildCommand || 'pnpm tauri ios build')
  }

  return commands
}

/**
 * @param {PlatformSelection} selection
 */
export function formatPlatformSelection(selection) {
  /** @type {string[]} */
  const parts = []
  if (selection.useDefaultDesktopBuild) parts.push('desktop')
  if (selection.windows) parts.push('windows')
  if (selection.macos) parts.push('macos')
  if (selection.linux) parts.push('linux')
  if (selection.android) parts.push('android')
  if (selection.ios) parts.push('ios')
  return parts.join(',')
}

/**
 * @param {PlatformSelection} selection
 */
export function platformSelectionLabel(selection) {
  /** @type {string[]} */
  const labels = []
  if (selection.useDefaultDesktopBuild) labels.push('桌面（当前主机）')
  if (selection.windows) labels.push('Windows')
  if (selection.macos) labels.push('macOS')
  if (selection.linux) labels.push('Linux')
  if (selection.android) labels.push('Android')
  if (selection.ios) labels.push('iOS')
  return labels.join(' + ')
}

/**
 * @param {PlatformSelection} selection
 * @param {Record<string, unknown>} releaseCfg
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function describeBuildPlan(selection, releaseCfg, releaseConfigRaw) {
  return resolveBuildCommands(selection, releaseCfg, releaseConfigRaw)
}
