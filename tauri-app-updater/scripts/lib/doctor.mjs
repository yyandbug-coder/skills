/**
 * 发版前体检。
 *
 * 这里查的每一条，都对应一种「发出去之后才会暴露」的事故：
 *   - 私钥与 tauri.conf 的 pubkey 不成对 → 用户点安装时报
 *     `signature created with a different key`，包已经发出去了
 *   - endpoints 里有死链 → 说好的多平台容灾根本不存在
 *   - createUpdaterArtifacts 没开 → 构建完才发现没有 .sig
 *   - token 没配 → 构建两小时后倒在上传那一步
 */
import { existsSync } from 'node:fs'

import { readJson, toRelative } from './project.mjs'
import {
  latestJsonEndpoint,
  listTargets,
  missingTokenHint,
  NO_TARGET_HINTS,
  NO_TARGET_MESSAGE,
} from './targets.mjs'
import { readConfiguredPubkey, readSiblingPubkey, resolveSigningKey } from './signing.mjs'
import { probe, requestJson } from './http.mjs'
import { isGitRepo } from './git.mjs'

/**
 * @typedef {object} CheckResult
 * @property {string} name
 * @property {'ok' | 'warn' | 'fail'} status
 * @property {string} message
 * @property {string[]} [hints]
 */

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {{ online?: boolean }} [options]
 * @returns {Promise<CheckResult[]>}
 */
export async function runDoctor(config, options = {}) {
  /** @type {CheckResult[]} */
  const results = []

  results.push(checkTauriConfig(config))
  results.push(checkSigningKey(config))
  results.push(...checkTargets(config))
  results.push(checkGit(config))

  if (options.online !== false) {
    results.push(...(await checkEndpoints(config)))
  }

  return results
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {CheckResult}
 */
function checkTauriConfig(config) {
  if (!existsSync(config.tauriConfigPath)) {
    return { name: 'tauri.conf.json', status: 'fail', message: `未找到 ${config.tauriConfigPath}` }
  }

  const tauri = readJson(config.tauriConfigPath)
  /** @type {string[]} */
  const problems = []

  if (tauri?.bundle?.createUpdaterArtifacts !== true) {
    problems.push('bundle.createUpdaterArtifacts 未设为 true —— 构建不会产出 .sig')
  }
  const endpoints = tauri?.plugins?.updater?.endpoints
  if (!Array.isArray(endpoints) || endpoints.length === 0) {
    problems.push('plugins.updater.endpoints 为空')
  }
  if (!tauri?.plugins?.updater?.pubkey) {
    problems.push('plugins.updater.pubkey 未配置')
  }

  if (problems.length > 0) {
    // endpoints 是从发版目标推出来的：目标都没配的时候说「doctor --fix 能补」是骗人的。
    // 而且此时 endpoints 为空不该判红——本地构建用不到它，配了目标自然就有了。
    const noTargets = listTargets(config).length === 0
    const onlyEndpoints = problems.length === 1 && problems[0].includes('endpoints')
    if (noTargets && onlyEndpoints) {
      return {
        name: 'tauri.conf.json',
        status: 'warn',
        message: 'endpoints 为空——配好发版目标后 doctor --fix 会自动填',
      }
    }
    return {
      name: 'tauri.conf.json',
      status: 'fail',
      message: problems.join('；'),
      hints: noTargets
        ? ['endpoints 要先配好发版目标才推得出来（见下一条）', '其余项 doctor --fix 可自动补']
        : ['这几项都能自动补：doctor --fix'],
    }
  }
  return { name: 'tauri.conf.json', status: 'ok', message: `updater 配置完整（${endpoints.length} 个 endpoint）` }
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {CheckResult}
 */
function checkSigningKey(config) {
  try {
    const key = resolveSigningKey(config)
    const configured = readConfiguredPubkey(config.tauriConfigPath)
    const sibling = key.source === 'file' ? readSiblingPubkey(key.keyPath) : null

    if (sibling && sibling.keynum !== configured.keynum) {
      return {
        name: '签名密钥',
        status: 'fail',
        message: `私钥的 .pub（${sibling.keynum}）与 tauri.conf.json pubkey（${configured.keynum}）不是同一把`,
        hints: [
          '用私钥旁的 .pub 覆盖配置：cli.mjs doctor --fix-pubkey',
          '或换回与配置匹配的私钥；改了 pubkey 的话老版本客户端将无法验证新包',
        ],
      }
    }

    const where = key.source === 'env' ? key.keyPath : toRelative(config.projectRoot, key.keyPath)
    return {
      name: '签名密钥',
      status: sibling ? 'ok' : 'warn',
      message: sibling
        ? `私钥与 pubkey 成对（keynum ${configured.keynum}，来自 ${where}）`
        : `已找到私钥（${where}），但缺少 .pub，无法离线比对 keynum`,
    }
  } catch (error) {
    return {
      name: '签名密钥',
      status: 'fail',
      message: error instanceof Error ? error.message : String(error),
      hints: error?.hints ?? [],
    }
  }
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {CheckResult[]}
 */
function checkTargets(config) {
  const targets = listTargets(config)
  if (targets.length === 0) {
    // 只判 warn：**构建并不需要发版目标**，签名产物照样出得来。
    // 真正的强制在上传那一步（release --upload 会在构建之前就拦下来），
    // 免得「我只想本地打个包」的人被一片红挡住。
    return [{
      name: '发版目标',
      status: 'warn',
      message: `${NO_TARGET_MESSAGE}——只本地构建可忽略，上传前必须配`,
      hints: NO_TARGET_HINTS,
    }]
  }

  return targets.map((target) => {
    if (target.name === 'custom') {
      // 自建的鉴权在 uploadCommand 内部（ssh key / aws 凭证 / token header），
      // Skill 管不到也不该管；能查的只有「命令配没配」。
      return {
        name: `${target.label}`,
        status: target.uploadCommand ? 'ok' : 'warn',
        message: target.uploadCommand
          ? `${target.baseUrl}（uploadCommand 已配置）`
          : `${target.baseUrl} —— 未配置 custom.uploadCommand，上传阶段会失败`,
      }
    }

    return {
      name: `${target.label} token`,
      status: target.token ? 'ok' : 'warn',
      message: target.token
        ? `${target.owner}/${target.repo}（token 已就绪）`
        : `${target.owner}/${target.repo} —— ${missingTokenHint(target)}，上传阶段会跳过该平台`,
    }
  })
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {CheckResult}
 */
function checkGit(config) {
  if (!isGitRepo(config.projectRoot)) {
    return { name: 'git', status: 'warn', message: '不是 git 仓库，--push 不可用' }
  }
  return { name: 'git', status: 'ok', message: '仓库可用' }
}

/**
 * 逐个拉 tauri.conf.json 里配的 endpoint。**死端点是静默失效的**：
 * 主端点正常时谁也不会发现备用端点早就 404 了。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @returns {Promise<CheckResult[]>}
 */
async function checkEndpoints(config) {
  const tauri = readJson(config.tauriConfigPath)
  const endpoints = tauri?.plugins?.updater?.endpoints
  if (!Array.isArray(endpoints) || endpoints.length === 0) return []

  const expected = new Map(listTargets(config).map((target) => [latestJsonEndpoint(target), target.label]))

  /** @type {CheckResult[]} */
  const results = []
  for (const endpoint of endpoints) {
    const label = expected.get(endpoint) ?? '未知目标'
    const result = await requestJson(endpoint, { timeoutMs: 30_000 })

    if (!result.ok) {
      results.push({
        name: `endpoint · ${label}`,
        status: 'fail',
        message: `HTTP ${result.status || '连接失败'} — ${endpoint}`,
        hints: ['该平台还没发布过 Release，或 owner/repo 写错了；死端点等于没有容灾'],
      })
      continue
    }

    const shape = describeManifest(result.json)
    results.push({
      name: `endpoint · ${label}`,
      status: shape.valid ? 'ok' : 'fail',
      message: shape.valid ? shape.summary : `${shape.summary} — ${endpoint}`,
    })
  }

  // 配置了目标但没写进 endpoints，等于白配。
  for (const [endpoint, label] of expected) {
    if (!endpoints.includes(endpoint)) {
      results.push({
        name: `endpoint · ${label}`,
        status: 'warn',
        message: `已配置 ${label} 但 tauri.conf.json 的 endpoints 里没有它`,
        hints: [`补上：${endpoint}`],
      })
    }
  }

  return results
}

/**
 * 识别两种合法的 manifest 形状。
 *
 * - **静态**：`{ version, platforms: { "darwin-aarch64": { url, signature } } }`
 * - **动态**：`{ version, url, signature }` —— 服务端按请求里的 `{{target}}`/`{{arch}}`
 *   自己决定返回哪个包（自建服务器才用得上，能做灰度）。插件两种都认，
 *   所以体检也不能只认静态那种。
 *
 * @param {unknown} json
 */
function describeManifest(json) {
  const manifest = /** @type {Record<string, unknown>} */ (json ?? {})
  const version = manifest.version
  if (typeof version !== 'string' || !version) {
    return { valid: false, dynamic: false, summary: 'manifest 缺少 version' }
  }

  const platforms = Object.keys(manifest.platforms ?? {})
  if (platforms.length > 0) {
    return { valid: true, dynamic: false, summary: `v${version} · ${platforms.join(', ')}` }
  }
  if (typeof manifest.url === 'string' && typeof manifest.signature === 'string') {
    return { valid: true, dynamic: true, summary: `v${version} · 动态 manifest（服务端按 target 分发）` }
  }
  return { valid: false, dynamic: false, summary: 'manifest 既没有 platforms 也没有 url/signature' }
}

/**
 * 发布后校验线上 manifest 与每个安装包是否真的可下。
 *
 * 「能检测到新版本、点下载报 HTTP 500」就是这一步没做：GitCode 对缺失附件返回 500
 * 而不是 404，manifest 却生成得好好的。
 *
 * @param {object} options
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} options.config
 * @param {string} options.version
 * @returns {Promise<CheckResult[]>}
 */
export async function verifyPublishedRelease({ config, version }) {
  const expectedVersion = String(version).replace(/^v/, '')
  const targets = listTargets(config)
  if (targets.length === 0) {
    return [{ name: '发版目标', status: 'fail', message: NO_TARGET_MESSAGE, hints: NO_TARGET_HINTS }]
  }

  /** @type {CheckResult[]} */
  const results = []

  for (const target of targets) {
    const endpoint = latestJsonEndpoint(target)
    const manifest = await requestJson(endpoint, { timeoutMs: 30_000 })

    if (!manifest.ok) {
      results.push({
        name: `${target.label} · latest.json`,
        status: 'fail',
        message: `HTTP ${manifest.status || '连接失败'} — ${endpoint}`,
      })
      continue
    }

    if (manifest.json?.version !== expectedVersion) {
      results.push({
        name: `${target.label} · latest.json`,
        status: 'fail',
        message: `线上版本是 ${manifest.json?.version}，期望 ${expectedVersion}`,
        hints: ['latest.json 没传上去，或传到了别的 tag'],
      })
      continue
    }

    const shape = describeManifest(manifest.json)
    results.push({
      name: `${target.label} · latest.json`,
      status: shape.valid ? 'ok' : 'fail',
      message: shape.summary,
    })
    if (!shape.valid) continue

    // 动态 manifest 的 url 是服务端按请求头挑的，这里只有一条可探；
    // 归属校验也没意义（本来就该由服务端自己决定指向哪）。
    const platforms = shape.dynamic
      ? [['（动态）', { url: manifest.json.url, signature: manifest.json.signature }]]
      : Object.entries(manifest.json?.platforms ?? {})

    // manifest 里的 URL 必须指向本平台自己，否则「容灾」只是把请求转回同一台机器。
    const foreign = shape.dynamic
      ? []
      : platforms.filter(([, value]) => !isOwnHost(target, String(value.url)))
    if (foreign.length > 0) {
      results.push({
        name: `${target.label} · URL 归属`,
        status: 'fail',
        message: `${foreign.length} 个平台的下载地址指向了别的托管方`,
        hints: [`例：${foreign[0][0]} → ${foreign[0][1].url}`, '该目标的 latest.json 需按自己的 URL 规则单独生成'],
      })
    }

    for (const [key, value] of platforms) {
      if (!value.signature) {
        results.push({ name: `${target.label} · ${key}`, status: 'fail', message: 'signature 为空' })
        continue
      }
      const reachable = await probe(String(value.url))
      const ok = reachable.status >= 200 && reachable.status < 400
      results.push({
        name: `${target.label} · ${key}`,
        status: ok ? 'ok' : 'fail',
        message: ok
          ? `可下载（HTTP ${reachable.status}${reachable.size ? `, ${formatBytes(reachable.size)}` : ''}）`
          : `HTTP ${reachable.status || reachable.error || '连接失败'} — 安装包很可能没上传到 Release`,
      })
    }
  }

  return results
}

/**
 * @param {NonNullable<ReturnType<import('./targets.mjs').getTarget>>} target
 * @param {string} url
 */
function isOwnHost(target, url) {
  try {
    const host = new URL(url).host
    if (target.name === 'github') return /github\.com$/.test(host)
    if (target.name === 'gitcode') return /gitcode\.com$/.test(host)
    // 自建：与 baseUrl 同主机即可（CDN 换域名的话请把 baseUrl 配成 CDN 域名）
    return host === new URL(String(target.baseUrl)).host
  } catch {
    return false
  }
}

/** @param {number} bytes */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
