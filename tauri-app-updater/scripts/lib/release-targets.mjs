/**
 * 解析 GitHub / GitCode 发版目标与下载基址。
 */

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function getGithubConfig(releaseConfigRaw) {
  const githubCfg = releaseConfigRaw.github ?? {}
  return {
    owner: process.env.GITHUB_OWNER || githubCfg.owner || '',
    repo: process.env.GITHUB_REPO || githubCfg.repo || '',
    apiUrl: process.env.GITHUB_API_URL || githubCfg.apiUrl || 'https://api.github.com',
    defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || githubCfg.defaultBranch || 'master',
  }
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function getGitcodeConfig(releaseConfigRaw) {
  const gitcodeCfg = releaseConfigRaw.gitcode ?? {}
  return {
    owner: process.env.GITCODE_OWNER || gitcodeCfg.owner || '',
    repo: process.env.GITCODE_REPO || gitcodeCfg.repo || '',
    apiUrl: process.env.GITCODE_API_URL || gitcodeCfg.apiUrl || 'https://api.gitcode.com/api/v5',
    defaultBranch: process.env.GITCODE_DEFAULT_BRANCH || gitcodeCfg.defaultBranch || 'master',
  }
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 * @returns {'github' | 'gitcode'}
 */
export function resolvePrimaryReleaseTarget(releaseConfigRaw) {
  const targets = listConfiguredReleaseTargets(releaseConfigRaw)
  if (targets.includes('gitcode')) return 'gitcode'
  if (targets.includes('github')) return 'github'
  return 'gitcode'
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 * @returns {'github' | 'gitcode'}
 */
export function resolveMobileUpdateTarget(releaseConfigRaw) {
  const mobileUpdate = releaseConfigRaw.mobile?.update ?? {}
  const configured = mobileUpdate.target
  if (configured === 'github' || configured === 'gitcode') return configured
  return resolvePrimaryReleaseTarget(releaseConfigRaw)
}

/**
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveReleaseApiUrl(target, releaseConfigRaw) {
  if (target === 'github') {
    const { owner, repo, apiUrl } = getGithubConfig(releaseConfigRaw)
    return `${apiUrl}/repos/${owner}/${repo}/releases/latest`
  }

  const { owner, repo, apiUrl } = getGitcodeConfig(releaseConfigRaw)
  return `${apiUrl}/repos/${owner}/${repo}/releases/latest`
}

/**
 * Release 列表/最新页（供移动端浏览器打开）。
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveReleasePageUrl(target, releaseConfigRaw) {
  const override = releaseConfigRaw.mobile?.update?.releasePageUrl
  if (override) return String(override)

  if (target === 'github') {
    const { owner, repo } = getGithubConfig(releaseConfigRaw)
    return `https://github.com/${owner}/${repo}/releases/latest`
  }

  const { owner, repo } = getGitcodeConfig(releaseConfigRaw)
  return `https://gitcode.com/${owner}/${repo}/releases`
}

/**
 * 指定版本的 Release 页（检测到新版本后跳转）。
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 * @param {string} version
 */
export function resolveReleasePageUrlForVersion(target, releaseConfigRaw, version) {
  const tagName = version.startsWith('v') ? version : `v${version}`
  return `${resolveReleasePageTagBase(target, releaseConfigRaw)}${tagName}`
}

/**
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveReleasePageTagBase(target, releaseConfigRaw) {
  if (target === 'github') {
    const { owner, repo } = getGithubConfig(releaseConfigRaw)
    return `https://github.com/${owner}/${repo}/releases/tag/`
  }

  const { owner, repo } = getGitcodeConfig(releaseConfigRaw)
  return `https://gitcode.com/${owner}/${repo}/releases/tag/`
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveMobileVersionCheckUrl(releaseConfigRaw) {
  const override = releaseConfigRaw.mobile?.update?.versionCheckUrl
  if (override) return String(override)

  const target = resolveMobileUpdateTarget(releaseConfigRaw)
  return resolveLatestJsonEndpoint(target, releaseConfigRaw)
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 * @returns {'latest-json' | 'release-api'}
 */
export function resolveMobileVersionSource(releaseConfigRaw) {
  const configured = releaseConfigRaw.mobile?.update?.versionSource
  if (configured === 'latest-json' || configured === 'release-api') return configured
  return 'latest-json'
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function buildMobileUpdateConfig(releaseConfigRaw) {
  const target = resolveMobileUpdateTarget(releaseConfigRaw)
  return {
    target,
    versionSource: resolveMobileVersionSource(releaseConfigRaw),
    versionCheckUrl: resolveMobileVersionCheckUrl(releaseConfigRaw),
    releaseApiUrl:
      releaseConfigRaw.mobile?.update?.releaseApiUrl || resolveReleaseApiUrl(target, releaseConfigRaw),
    releasePageUrl: resolveReleasePageUrl(target, releaseConfigRaw),
    releasePageTagBase: resolveReleasePageTagBase(target, releaseConfigRaw),
  }
}

/**
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 * @param {string} version
 */
export function resolveReleaseBaseUrl(target, releaseConfigRaw, version) {
  const tagName = version.startsWith('v') ? version : `v${version}`

  if (process.env.RELEASE_BASE_URL && process.env.RELEASE_TARGET === target) {
    return process.env.RELEASE_BASE_URL
  }

  if (target === 'github') {
    const { owner, repo } = getGithubConfig(releaseConfigRaw)
    if (!owner || !repo) {
      throw new Error('[release-targets] release.config.json 缺少 github.owner / github.repo')
    }
    return `https://github.com/${owner}/${repo}/releases/download/${tagName}`
  }

  const { owner, repo } = getGitcodeConfig(releaseConfigRaw)
  if (!owner || !repo) {
    throw new Error('[release-targets] release.config.json 缺少 gitcode.owner / gitcode.repo')
  }
  return `https://api.gitcode.com/api/v5/repos/${owner}/${repo}/releases/${tagName}/attach_files`
}

/**
 * @param {'github' | 'gitcode'} target
 * @param {Record<string, unknown>} releaseConfigRaw
 */
export function resolveLatestJsonEndpoint(target, releaseConfigRaw) {
  if (target === 'github') {
    const { owner, repo } = getGithubConfig(releaseConfigRaw)
    return `https://github.com/${owner}/${repo}/releases/latest/download/latest.json`
  }

  const { owner, repo } = getGitcodeConfig(releaseConfigRaw)
  return `https://api.gitcode.com/api/v5/repos/${owner}/${repo}/releases/latest/attach_files/latest.json/download`
}

/**
 * @param {Record<string, unknown>} releaseConfigRaw
 * @returns {Array<'github' | 'gitcode'>}
 */
export function listConfiguredReleaseTargets(releaseConfigRaw) {
  /** @type {Array<'github' | 'gitcode'>} */
  const targets = []
  const github = getGithubConfig(releaseConfigRaw)
  const gitcode = getGitcodeConfig(releaseConfigRaw)
  if (github.owner && github.repo) targets.push('github')
  if (gitcode.owner && gitcode.repo) targets.push('gitcode')
  return targets
}
