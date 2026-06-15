import { useCallback, useState } from 'react'

import {
  checkAndOpenMobileRelease,
  checkMobileUpdate,
  openMobileReleasePage,
  type MobileUpdatePhase,
  type MobileUpdateResult,
} from '../lib/mobile-update'

export type UseMobileUpdateState = {
  phase: MobileUpdatePhase
  currentVersion: string
  latestVersion?: string
  releasePageUrl?: string
  error?: string
}

const idleState: UseMobileUpdateState = {
  phase: 'idle',
  currentVersion: '',
}

function toState(result: MobileUpdateResult): UseMobileUpdateState {
  return {
    phase: result.phase,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    releasePageUrl: result.releasePageUrl,
    error: result.error,
  }
}

/**
 * 移动端更新 Hook：检查版本后跳转 GitCode / GitHub Release 页。
 * 桌面端请使用 useAppUpdater + tauri-plugin-updater。
 */
export function useMobileUpdate() {
  const [state, setState] = useState<UseMobileUpdateState>(idleState)

  const checkForUpdate = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: 'checking', error: undefined }))
    const result = await checkMobileUpdate()
    setState(toState(result))
    return result
  }, [])

  const checkAndOpenRelease = useCallback(async () => {
    setState((prev) => ({ ...prev, phase: 'checking', error: undefined }))
    const result = await checkAndOpenMobileRelease()
    setState(toState(result))
    return result
  }, [])

  const openReleasePage = useCallback(async (version?: string) => {
    await openMobileReleasePage(version)
  }, [])

  return {
    ...state,
    isChecking: state.phase === 'checking',
    hasUpdate: state.phase === 'available',
    checkForUpdate,
    checkAndOpenRelease,
    openReleasePage,
  }
}
