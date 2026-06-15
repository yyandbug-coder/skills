import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * @param {string} projectRoot
 */
export function loadReleaseConfigRaw(projectRoot) {
  const configPath = join(projectRoot, 'release.config.json')
  if (!existsSync(configPath)) {
    throw new Error(
      `[tauri-app-updater] 缺少 release.config.json。请先运行：node "${join(homedir(), '.cursor/skills/tauri-app-updater/scripts/init-project.mjs')}"`,
    )
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'))
}

/**
 * @param {string} projectRoot
 */
export function resolveSigningPrivateKeyPath(projectRoot, signingCfg = {}) {
  const envKeyVar = signingCfg.envKeyVar || 'TAURI_SIGNING_PRIVATE_KEY'
  if (process.env[envKeyVar]) {
    return process.env[envKeyVar]
  }

  const configured = signingCfg.privateKeyPath
  if (configured) {
    if (configured.startsWith('~')) {
      const home = process.env.USERPROFILE || process.env.HOME || ''
      return join(home, configured.slice(2).replace(/^[\\/]/, ''))
    }
    return join(projectRoot, configured)
  }

  const home = process.env.USERPROFILE || process.env.HOME || ''
  return join(home, '.tauri', 'app.key')
}

/**
 * @param {string} projectRoot
 */
export function createBuildEnv(projectRoot, extraEnv = {}) {
  const raw = loadReleaseConfigRaw(projectRoot)
  const signingCfg = raw.signing ?? {}
  const passwordVar = signingCfg.envPasswordVar || 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
  const password = process.env[passwordVar] ?? signingCfg.privateKeyPassword ?? ''

  return {
    ...process.env,
    TAURI_SIGNING_PRIVATE_KEY: resolveSigningPrivateKeyPath(projectRoot, signingCfg),
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
    ...extraEnv,
  }
}

/**
 * @param {string} projectRoot
 */
export function getAppDisplayName(projectRoot, rawConfig) {
  if (rawConfig?.appName) return rawConfig.appName
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
    return pkg.productName || pkg.name || 'App'
  } catch {
    return 'App'
  }
}
