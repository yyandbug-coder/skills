/**
 * `cli.mjs doctor` —— 发版前体检。
 *
 * `--fix` 顺手把两样机械活干了：把私钥的 `.pub` 同步进 `tauri.conf.json`，
 * 以及按已配置的发版目标补出 updater 配置块。接入新项目时这两件事纯属抄写，
 * 手抄却极容易出错——endpoint 的路径形状 GitCode 与 GitHub 完全不同，
 * 抄错了要等到第一次发版才发现。
 */
import { writeFileSync } from 'node:fs'

import { runDoctor } from '../lib/doctor.mjs'
import { log, ReleaseError, setLogScope } from '../lib/log.mjs'
import { readJson, toRelative } from '../lib/project.mjs'
import { printReport } from '../lib/report.mjs'
import { readSiblingPubkey, resolveSigningKey } from '../lib/signing.mjs'
import { latestJsonEndpoint, listTargets } from '../lib/targets.mjs'

/**
 * @param {object} context
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} context.config
 * @param {import('../lib/args.mjs').Args} context.args
 */
export async function doctorCommand({ config, args }) {
  setLogScope('doctor')

  const fixAll = args.has('fix')
  if (fixAll || args.has('fix-config')) syncUpdaterConfig(config)
  if (fixAll || args.has('fix-pubkey')) syncPubkey(config)

  const results = await runDoctor(config, { online: !args.has('offline') })
  const { failed } = printReport(results, `${config.appName} 发版体检`)

  if (failed > 0) {
    throw new ReleaseError(`${failed} 项检查未通过`, {
      hints: ['能自动补的先跑：doctor --fix', '其余按上面每条的提示处理后重跑'],
    })
  }
  log.ok('可以发版')
}

/**
 * 按 release.config.json 里已配置的目标，补齐 tauri.conf.json 的 updater 配置。
 *
 * 只做加法：已存在的 endpoints 保留并去重（用户可能手工加过自建镜像），
 * pubkey 不在这里动（那是 syncPubkey 的事）。
 *
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 */
function syncUpdaterConfig(config) {
  const targets = listTargets(config)
  if (targets.length === 0) {
    throw new ReleaseError('release.config.json 还没配置 github / gitcode，无法推导 endpoints')
  }

  const tauri = readJson(config.tauriConfigPath)
  /** @type {string[]} */
  const changes = []

  tauri.bundle ??= {}
  if (tauri.bundle.createUpdaterArtifacts !== true) {
    tauri.bundle.createUpdaterArtifacts = true
    changes.push('bundle.createUpdaterArtifacts = true')
  }

  tauri.plugins ??= {}
  tauri.plugins.updater ??= {}
  const updater = tauri.plugins.updater

  const existing = Array.isArray(updater.endpoints) ? updater.endpoints : []
  const wanted = targets.map((target) => latestJsonEndpoint(target))
  const merged = [...new Set([...existing, ...wanted])]
  if (merged.length !== existing.length) {
    updater.endpoints = merged
    for (const endpoint of wanted) {
      if (!existing.includes(endpoint)) changes.push(`+ endpoint ${endpoint}`)
    }
  }

  // passive：装更新时给用户一个进度条，但不需要点「下一步」。
  updater.windows ??= {}
  if (!updater.windows.installMode) {
    updater.windows.installMode = 'passive'
    changes.push('plugins.updater.windows.installMode = "passive"')
  }

  if (changes.length === 0) {
    log.info('tauri.conf.json 的 updater 配置已完整')
    return
  }

  writeFileSync(config.tauriConfigPath, `${JSON.stringify(tauri, null, 2)}\n`, 'utf8')
  log.ok(`已更新 ${toRelative(config.projectRoot, config.tauriConfigPath)}`)
  for (const change of changes) log.detail(change)
}

/**
 * @param {ReturnType<import('../lib/project.mjs').loadReleaseConfig>} config
 */
function syncPubkey(config) {
  const key = resolveSigningKey(config)
  if (key.source !== 'file') {
    throw new ReleaseError('同步公钥需要本地私钥文件（当前私钥来自环境变量）')
  }

  const sibling = readSiblingPubkey(key.keyPath)
  if (!sibling) {
    throw new ReleaseError(`未找到公钥文件：${toRelative(config.projectRoot, key.keyPath)}.pub`, {
      hints: ['重新生成一对：tauri signer generate -w <私钥路径> --force --ci'],
    })
  }

  const tauri = readJson(config.tauriConfigPath)
  tauri.plugins ??= {}
  tauri.plugins.updater ??= {}
  const previous = tauri.plugins.updater.pubkey

  if (previous === sibling.raw) {
    log.info('pubkey 已是最新，无需改动')
    return
  }

  tauri.plugins.updater.pubkey = sibling.raw
  writeFileSync(config.tauriConfigPath, `${JSON.stringify(tauri, null, 2)}\n`, 'utf8')

  log.ok(`已同步 pubkey（keynum ${sibling.keynum}）← ${toRelative(config.projectRoot, sibling.path)}`)
  if (previous) {
    log.warn('pubkey 变了：已装旧版本的用户无法验证新包的签名，必须手动重装一次')
  }
}

/** 供 release 流程复用：只跑离线项，任一 fail 即抛。 */
export async function assertHealthy(config) {
  const results = await runDoctor(config, { online: false })
  const failed = results.filter((result) => result.status === 'fail')
  if (failed.length > 0) {
    printReport(results, '发版前体检')
    throw new ReleaseError('体检未通过，已中止发版', {
      hints: failed.map((result) => `${result.name}：${result.message}`),
    })
  }
  return results
}
