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
    if (!value || value.startsWith('-')) {
      throw new Error('[release-platforms] --platform 缺少平台值，例如：--platform desktop,android')
    }
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
  if (lower.endsWith('.dmg') && kinds.has('macos')) return true
  if (lower.endsWith('.appimage') && kinds.has('linux')) return true

  if (lower.endsWith('.sig')) {
    const bundleName = fileName.slice(0, -4)
    return allowsDesktopArtifact(bundleName, selection)
  }

  return false
}

/**
 * 是否为「桌面 + 移动端」一体发版脚本（如 pnpm tauri:deploy）。
 * @param {string} command
 */
function isCombinedBuildCommand(command) {
  return /\b(tauri:deploy|tauri:release|tauri-deploy|tauri-release)\b/.test(command)
}

/**
 * @param {string} command
 */
function isProjectReleaseScript(command) {
  return /\b(tauri-release\.mjs|tauri-deploy\.mjs)\b/.test(command)
}

/**
 * @param {string} command
 * @param {string} flag
 */
function appendCliFlag(command, flag) {
  if (new RegExp(`\\s${flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(command)) {
    return command
  }
  return `${command} ${flag}`
}

/**
 * 桌面（当前主机）实际使用的构建命令。
 * @param {Record<string, unknown>} releaseCfg
 * @param {Record<string, unknown>} desktopCfg
 */
function resolveEffectiveDefaultDesktopCommand(releaseCfg, desktopCfg) {
  if (typeof desktopCfg.defaultBuildCommand === 'string' && desktopCfg.defaultBuildCommand.trim()) {
    return desktopCfg.defaultBuildCommand.trim()
  }
  return String(releaseCfg.tauriBuildCommand || 'pnpm tauri build')
}

/**
 * 仅选「桌面（当前主机）」时的默认构建命令。
 * @param {Record<string, unknown>} releaseCfg
 * @param {Record<string, unknown>} desktopCfg
 */
function resolveDesktopDefaultCommand(releaseCfg, desktopCfg) {
  const command = resolveEffectiveDefaultDesktopCommand(releaseCfg, desktopCfg)
  if (isCombinedBuildCommand(command)) {
    return appendCliFlag(command, '--skip-android')
  }
  return command
}

/**
 * @param {PlatformSelection} selection
 * @param {Record<string, unknown>} releaseCfg
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveBuildCommands(selection, releaseCfg, releaseConfigRaw) {
  const desktopCfg = releaseConfigRaw.desktop ?? {}
  const mobileCfg = releaseConfigRaw.mobile ?? {}
  const defaultDesktopCommand = resolveEffectiveDefaultDesktopCommand(releaseCfg, desktopCfg)
  const wantsDesktop = hasDesktopBuild(selection)
  const wantsMobile = hasMobileBuild(selection)
  const usesDefaultDesktopOnly =
    selection.useDefaultDesktopBuild && !selection.windows && !selection.macos && !selection.linux

  /** @type {string[]} */
  const commands = []

  // 一体发版脚本：按所选平台追加 --skip-android，避免「只选桌面仍打 Android」
  if (isCombinedBuildCommand(defaultDesktopCommand) && usesDefaultDesktopOnly) {
    if (wantsDesktop && wantsMobile) {
      commands.push(defaultDesktopCommand)
      return commands
    }
    if (wantsDesktop) {
      commands.push(appendCliFlag(defaultDesktopCommand, '--skip-android'))
      return commands
    }
    if (wantsMobile) {
      if (selection.android) {
        commands.push(mobileCfg.androidBuildCommand || 'pnpm tauri android build --apk --aab')
      }
      if (selection.ios) {
        commands.push(mobileCfg.iosBuildCommand || 'pnpm tauri ios build')
      }
      return commands
    }
  }

  if (selection.useDefaultDesktopBuild) {
    commands.push(resolveDesktopDefaultCommand(releaseCfg, desktopCfg))
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
    commands.push(mobileCfg.androidBuildCommand || 'pnpm tauri android build --apk --aab')
  }
  if (selection.ios) {
    commands.push(mobileCfg.iosBuildCommand || 'pnpm tauri ios build')
  }

  return commands
}

/**
 * 将发版选项（如 --skip-bump）附加到项目自定义构建脚本。
 * Skill 自身已跳过 bump，但 pnpm tauri:deploy / tauri-release.mjs 等仍会在构建末尾递增版本，须透传。
 *
 * @param {string} command
 * @param {{ skipBump?: boolean }} [options]
 */
export function applyReleaseBuildOptions(command, options = {}) {
  let cmd = String(command)
  if (!options.skipBump) return cmd
  if (isCombinedBuildCommand(cmd) || isProjectReleaseScript(cmd)) {
    cmd = appendCliFlag(cmd, '--skip-bump')
  }
  return cmd
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
