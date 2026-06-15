import { getVersion } from '@tauri-apps/api/app'
import { openUrl } from '@tauri-apps/plugin-opener'

import { mobileUpdateConfig } from './mobile-update-config.generated'

export type MobileUpdatePhase = 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'

export type MobileUpdateResult = {
  phase: MobileUpdatePhase
  currentVersion: string
  latestVersion?: string
  releasePageUrl?: string
  error?: string
}

/** 比较语义化版本，返回值 > 0 表示 a 比 b 新。 */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/, '')
      .split(/[.-]/)
      .map((part) => Number.parseInt(part, 10) || 0)

  const left = parse(a)
  const right = parse(b)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}

export function buildReleasePageUrl(version?: string): string {
  if (!version) return mobileUpdateConfig.releasePageUrl
  const tagName = version.startsWith('v') ? version : `v${version}`
  return `${mobileUpdateConfig.releasePageTagBase}${tagName}`
}

async function fetchLatestVersionFromLatestJson(): Promise<string> {
  const response = await fetch(mobileUpdateConfig.versionCheckUrl)
  if (!response.ok) {
    throw new Error(`读取 latest.json 失败（HTTP ${response.status}）`)
  }
  const data = (await response.json()) as { version?: string }
  if (!data.version) {
    throw new Error('latest.json 缺少 version 字段')
  }
  return data.version.replace(/^v/, '')
}

async function fetchLatestVersionFromReleaseApi(): Promise<string> {
  const response = await fetch(mobileUpdateConfig.releaseApiUrl)
  if (!response.ok) {
    throw new Error(`读取 Release API 失败（HTTP ${response.status}）`)
  }
  const data = (await response.json()) as { tag_name?: string }
  if (!data.tag_name) {
    throw new Error('Release API 缺少 tag_name 字段')
  }
  return data.tag_name.replace(/^v/, '')
}

export async function fetchLatestVersion(): Promise<string> {
  if (mobileUpdateConfig.versionSource === 'release-api') {
    return fetchLatestVersionFromReleaseApi()
  }
  return fetchLatestVersionFromLatestJson()
}

/** 在系统浏览器打开 Release 页（用户自行下载 APK / 查看更新说明）。 */
export async function openMobileReleasePage(version?: string): Promise<void> {
  await openUrl(buildReleasePageUrl(version))
}

/**
 * 检查是否有新版本；若有则返回 Release 页 URL，由调用方决定是否跳转。
 * 桌面端请继续使用 tauri-plugin-updater，此函数仅用于 Android / iOS。
 */
export async function checkMobileUpdate(): Promise<MobileUpdateResult> {
  try {
    const currentVersion = (await getVersion()).replace(/^v/, '')
    const latestVersion = await fetchLatestVersion()

    if (compareSemver(latestVersion, currentVersion) > 0) {
      return {
        phase: 'available',
        currentVersion,
        latestVersion,
        releasePageUrl: buildReleasePageUrl(latestVersion),
      }
    }

    return {
      phase: 'up-to-date',
      currentVersion,
      latestVersion,
      releasePageUrl: buildReleasePageUrl(),
    }
  } catch (error) {
    return {
      phase: 'error',
      currentVersion: '',
      error: error instanceof Error ? error.message : String(error),
      releasePageUrl: buildReleasePageUrl(),
    }
  }
}

/** 检查到新版本时直接打开对应 Release 页。 */
export async function checkAndOpenMobileRelease(): Promise<MobileUpdateResult> {
  const result = await checkMobileUpdate()
  if (result.phase === 'available' && result.releasePageUrl) {
    await openUrl(result.releasePageUrl)
  }
  return result
}
