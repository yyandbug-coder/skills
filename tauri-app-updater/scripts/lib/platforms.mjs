/**
 * 桌面平台矩阵：选择哪些平台、去哪个 bundle 目录找产物、产物落到 latest.json 的哪个 key。
 *
 * **关于 `darwin-universal`**：tauri-plugin-updater 查表用的 key 是运行时的
 * `{os}-{arch}`，macOS 上只会是 `darwin-aarch64` 或 `darwin-x86_64`，**没有
 * `darwin-universal` 这个 key**。所以 universal 包必须同时挂到两个 arch key 下，
 * 否则 Intel 机器会拿到 `TargetNotFound` —— 而且插件是在「比对版本之前」就去取 URL 的
 * （updater.rs 里 `get_urls()` 先于 `should_update`），所以连「已是最新」都走不到，
 * 用户看到的是一个红色报错。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

import { ReleaseError } from './log.mjs'

/**
 * @typedef {object} PlatformDescriptor
 * @property {string} id            选择用的名字
 * @property {string} label         中文展示名
 * @property {string} os            windows | darwin | linux
 * @property {string | null} rustTarget  交叉编译 triple；null = 用主机默认构建
 * @property {string[]} updaterKeys latest.json 里 platforms 的 key（universal 映射两个）
 */

/** @type {Record<string, PlatformDescriptor>} */
export const PLATFORMS = {
  host: {
    id: 'host',
    label: '当前主机（默认构建）',
    os: hostOs(),
    rustTarget: null,
    updaterKeys: [],
  },
  'windows-x86_64': {
    id: 'windows-x86_64',
    label: 'Windows x64',
    os: 'windows',
    rustTarget: 'x86_64-pc-windows-msvc',
    updaterKeys: ['windows-x86_64'],
  },
  'windows-aarch64': {
    id: 'windows-aarch64',
    label: 'Windows ARM64',
    os: 'windows',
    rustTarget: 'aarch64-pc-windows-msvc',
    updaterKeys: ['windows-aarch64'],
  },
  'darwin-aarch64': {
    id: 'darwin-aarch64',
    label: 'macOS Apple Silicon',
    os: 'darwin',
    rustTarget: 'aarch64-apple-darwin',
    updaterKeys: ['darwin-aarch64'],
  },
  'darwin-x86_64': {
    id: 'darwin-x86_64',
    label: 'macOS Intel',
    os: 'darwin',
    rustTarget: 'x86_64-apple-darwin',
    updaterKeys: ['darwin-x86_64'],
  },
  'darwin-universal': {
    id: 'darwin-universal',
    label: 'macOS 通用（Intel + Apple Silicon）',
    os: 'darwin',
    rustTarget: 'universal-apple-darwin',
    updaterKeys: ['darwin-aarch64', 'darwin-x86_64'],
  },
  'linux-x86_64': {
    id: 'linux-x86_64',
    label: 'Linux x64',
    os: 'linux',
    rustTarget: 'x86_64-unknown-linux-gnu',
    updaterKeys: ['linux-x86_64'],
  },
}

/** 简写 → 展开。 */
const ALIASES = {
  windows: ['windows-x86_64'],
  macos: ['darwin-universal'],
  mac: ['darwin-universal'],
  darwin: ['darwin-universal'],
  linux: ['linux-x86_64'],
  desktop: ['host'],
}

function hostOs() {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'darwin'
  return 'linux'
}

/** 主机默认构建产出的 updater key（用于校验 manifest 完整性）。 */
export function hostUpdaterKeys() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64'
  return [`${hostOs()}-${arch}`]
}

/**
 * @param {string[]} tokens
 * @returns {PlatformDescriptor[]}
 */
export function resolvePlatforms(tokens) {
  const input = tokens.length > 0 ? tokens : ['host']
  /** @type {Map<string, PlatformDescriptor>} */
  const picked = new Map()

  for (const rawToken of input) {
    const token = rawToken.trim().toLowerCase()
    if (!token) continue

    const expanded = ALIASES[token] ?? [token]
    for (const id of expanded) {
      const descriptor = PLATFORMS[id]
      if (!descriptor) {
        throw new ReleaseError(`未知平台 "${rawToken}"`, {
          hints: [`可选：${Object.keys(PLATFORMS).join('、')}`, `简写：${Object.keys(ALIASES).join('、')}`],
        })
      }
      picked.set(id, descriptor)
    }
  }

  if (picked.size === 0) throw new ReleaseError('至少选择一个发版平台')
  return [...picked.values()]
}

/**
 * 该平台的 bundle 目录。主机构建在 target/release/bundle，交叉编译在 target/{triple}/release/bundle。
 * @param {string} projectRoot
 * @param {PlatformDescriptor} platform
 */
export function bundleDir(projectRoot, platform) {
  const base = join(projectRoot, 'src-tauri/target')
  return platform.rustTarget
    ? join(base, platform.rustTarget, 'release/bundle')
    : join(base, 'release/bundle')
}

/**
 * updater 认的安装包后缀，按优先级排列。
 *
 * Windows 上 NSIS(.exe) 与 WiX(.msi) 都能用；两者都在时优先 NSIS——它支持
 * `installMode: passive` 的静默升级，MSI 需要 msiexec 提权且更容易被策略拦。
 * @param {string} os
 */
export function updaterExtensions(os) {
  if (os === 'windows') return ['-setup.exe', '.msi']
  if (os === 'darwin') return ['.app.tar.gz']
  return ['.AppImage.tar.gz', '.AppImage']
}

/** 允许收集进 releases/ 的产物（含供人工下载的 .dmg / .msi）。 */
const COLLECTABLE = /\.(exe|msi|dmg|AppImage|tar\.gz|sig)$/i

/**
 * @param {string} dir
 * @param {string[]} [acc]
 */
export function walkFiles(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    if (statSync(fullPath).isDirectory()) walkFiles(fullPath, acc)
    else acc.push(fullPath)
  }
  return acc
}

/**
 * 收集某平台 bundle 目录下所有可发布产物。
 * @param {string} projectRoot
 * @param {PlatformDescriptor} platform
 */
export function collectArtifacts(projectRoot, platform) {
  return walkFiles(bundleDir(projectRoot, platform)).filter((file) => COLLECTABLE.test(basename(file)))
}

/**
 * 在一堆产物里挑出该平台的 updater 包（必须有配套 .sig）。
 *
 * 旧实现是「遍历所有 .exe，每个都覆写同一个 key」，谁最后被 readdir 到谁生效——
 * 顺序不确定，且完全不认 .msi。这里按后缀优先级明确挑一个。
 *
 * @param {string[]} files
 * @param {PlatformDescriptor} platform
 * @returns {{ bundle: string, sig: string } | null}
 */
export function pickUpdaterBundle(files, platform) {
  for (const extension of updaterExtensions(platform.os)) {
    const candidates = files
      .filter((file) => basename(file).toLowerCase().endsWith(extension.toLowerCase()))
      .filter((file) => existsSync(`${file}.sig`))
      .sort()
    if (candidates.length > 0) {
      return { bundle: candidates[0], sig: `${candidates[0]}.sig` }
    }
  }
  return null
}
