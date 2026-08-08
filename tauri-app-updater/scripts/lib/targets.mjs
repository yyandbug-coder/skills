/**
 * 发版目标（GitHub / GitCode）的 URL 规则与 token 解析。
 *
 * **每个目标必须拿到指向自己的 latest.json**。旧实现只生成一份（按主目标的 URL 规则），
 * 然后把同一份文件传到两个平台——于是从 GitHub 拉到的 manifest 里 URL 仍然指向 GitCode，
 * 「双端点容灾」名存实亡：GitCode 挂了，走 GitHub 端点拿到的下载地址照样是挂掉的 GitCode。
 */
import { ReleaseError } from './log.mjs'

/** @typedef {'github' | 'gitcode' | 'custom'} TargetName */

const DEFINITIONS = {
  github: {
    name: 'github',
    label: 'GitHub',
    tokenVars: ['GITHUB_TOKEN', 'GH_TOKEN'],
    defaultApiUrl: 'https://api.github.com',
  },
  gitcode: {
    name: 'gitcode',
    label: 'GitCode',
    tokenVars: ['GITCODE_TOKEN'],
    defaultApiUrl: 'https://api.gitcode.com/api/v5',
  },
  custom: {
    name: 'custom',
    label: '自建服务器',
    tokenVars: [],
    defaultApiUrl: '',
  },
}

/**
 * 自建更新服务器。
 *
 * 发版流水线里跟托管方绑定的只有两处：安装包 URL 规则、上传动作。前者就是一个
 * `baseUrl` 模板；后者各家（S3 / OSS / rsync / scp / curl）完全不同，穷举是无底洞，
 * 所以交给项目自己提供 `uploadCommand`——Skill 负责把产物准备好并告诉它目录在哪。
 *
 * 这样构建、签名、验签名、manifest、发布后探活全部照常工作。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 */
function getCustomTarget(config) {
  const raw = config.custom ?? {}
  const baseUrl = process.env.RELEASE_BASE_URL || raw.baseUrl || ''
  if (!baseUrl) return null

  return {
    ...DEFINITIONS.custom,
    label: raw.label || DEFINITIONS.custom.label,
    owner: '',
    repo: '',
    apiUrl: '',
    defaultBranch: '',
    token: 'n/a', // 自建的鉴权在 uploadCommand 里，不由 Skill 管
    baseUrl: baseUrl.replace(/\/+$/, ''),
    endpoint: raw.endpoint || '',
    uploadCommand: raw.uploadCommand || '',
  }
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {TargetName} name
 */
export function getTarget(config, name) {
  const definition = DEFINITIONS[name]
  if (!definition) throw new ReleaseError(`未知发版目标：${name}`)
  if (name === 'custom') return getCustomTarget(config)

  const raw = config[name] ?? {}
  const upper = name.toUpperCase()
  const owner = process.env[`${upper}_OWNER`] || raw.owner || ''
  const repo = process.env[`${upper}_REPO`] || raw.repo || ''
  if (!owner || !repo) return null

  return {
    ...definition,
    owner,
    repo,
    apiUrl: process.env[`${upper}_API_URL`] || raw.apiUrl || definition.defaultApiUrl,
    defaultBranch: process.env[`${upper}_DEFAULT_BRANCH`] || raw.defaultBranch || '',
    token: definition.tokenVars.map((name) => process.env[name]).find(Boolean) || '',
  }
}

/**
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 */
export function listTargets(config) {
  return /** @type {TargetName[]} */ (['github', 'gitcode', 'custom'])
    .map((name) => getTarget(config, name))
    .filter((target) => target !== null)
}

/**
 * 提交进仓库的 releases/latest.json 用哪个目标的 URL 规则。
 * 不指定就取第一个已配置的——但那是按字母序的偶然结果，所以配置里应显式写明。
 *
 * @param {ReturnType<import('./project.mjs').loadReleaseConfig>} config
 * @param {ReturnType<typeof listTargets>} targets
 */
export function pickPrimaryTarget(config, targets) {
  if (targets.length === 0) throw new ReleaseError('release.config.json 未配置 github / gitcode')
  const named = targets.find((target) => target.name === config.primaryTarget)
  return named ?? targets[0]
}

/** @param {string} version */
export function tagFor(version) {
  const normalized = String(version).replace(/^v/, '')
  return `v${normalized}`
}

/**
 * 单个安装包的下载地址。
 *
 * GitCode 的附件下载走 API：`.../releases/{tag}/attach_files/{文件名}/download`，
 * 文件名必须 encodeURIComponent（应用名普遍带空格）。GitHub 是静态路径。
 *
 * @param {NonNullable<ReturnType<typeof getTarget>>} target
 * @param {string} version
 * @param {string} fileName
 */
export function assetUrl(target, version, fileName) {
  const tag = tagFor(version)
  const encoded = encodeURIComponent(fileName)
  if (target.name === 'custom') {
    return `${expandCustomBase(target, version)}/${encoded}`
  }
  if (target.name === 'github') {
    return `https://github.com/${target.owner}/${target.repo}/releases/download/${tag}/${encoded}`
  }
  return `${target.apiUrl}/repos/${target.owner}/${target.repo}/releases/${tag}/attach_files/${encoded}/download`
}

/**
 * 自建的 baseUrl 支持 `{tag}` / `{version}` 占位；不写占位就当成固定目录
 * （每次发版覆盖同一份，适合「永远只留最新版」的部署）。
 *
 * @param {NonNullable<ReturnType<typeof getTarget>>} target
 * @param {string} version
 */
export function expandCustomBase(target, version) {
  const normalized = String(version).replace(/^v/, '')
  return String(target.baseUrl)
    .replace(/\{tag\}/g, `v${normalized}`)
    .replace(/\{version\}/g, normalized)
    .replace(/\/+$/, '')
}

/**
 * tauri.conf.json 里 `plugins.updater.endpoints` 该填的地址（永远指向 latest）。
 * @param {NonNullable<ReturnType<typeof getTarget>>} target
 */
export function latestJsonEndpoint(target) {
  if (target.name === 'custom') {
    // 显式配了就用；否则取 baseUrl 去掉版本段后的同级 latest.json。
    if (target.endpoint) return target.endpoint
    const base = String(target.baseUrl).replace(/\/\{(tag|version)\}.*$/, '').replace(/\/+$/, '')
    return `${base}/latest.json`
  }
  if (target.name === 'github') {
    return `https://github.com/${target.owner}/${target.repo}/releases/latest/download/latest.json`
  }
  return `${target.apiUrl}/repos/${target.owner}/${target.repo}/releases/latest/attach_files/latest.json/download`
}

/**
 * @param {NonNullable<ReturnType<typeof getTarget>>} target
 */
export function releasePageUrl(target) {
  if (target.name === 'custom') return latestJsonEndpoint(target).replace(/\/latest\.json$/, '')
  if (target.name === 'github') {
    return `https://github.com/${target.owner}/${target.repo}/releases`
  }
  return `https://gitcode.com/${target.owner}/${target.repo}/releases`
}

/**
 * @param {NonNullable<ReturnType<typeof getTarget>>} target
 */
export function missingTokenHint(target) {
  return `缺少 ${target.tokenVars.join(' / ')}（可写进项目根的 .env）`
}
